import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { Router } from "express";
import multer from "multer";
import { IssueRequestDomain, IssueRequestStatus, MaterialKind } from "@prisma/client";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import { config } from "../config.js";
import { assertObjectSectionInScope, getRequestDataScope } from "../lib/dataScope.js";
import { sha256File } from "../lib/fileHash.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const uploadDirAbs = path.resolve(process.cwd(), config.uploadsDir);
if (!fs.existsSync(uploadDirAbs)) {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDirAbs),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});

const upload = multer({ storage });

const DOMAINS: IssueRequestDomain[] = [
  IssueRequestDomain.MATERIALS,
  IssueRequestDomain.CONSUMABLES,
  IssueRequestDomain.WORKWEAR
];

const REPORT_MATERIAL_KINDS: MaterialKind[] = [
  MaterialKind.MATERIAL,
  MaterialKind.CONSUMABLE,
  MaterialKind.WORKWEAR
];

export const STOREKEEPER_HOLDER_KEY = "__storekeeper__";
export const STOREKEEPER_HOLDER_NAME = "Кладовщик";

function composeKey(holderKey: string, materialId: string) {
  return `${holderKey}:${materialId}`;
}

function normalizePersonKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function personHolderKey(name: string) {
  return `person:${normalizePersonKey(name)}`;
}

function issueResponsibleLabel(issue: {
  responsibleName: string | null;
  actualRecipientName: string | null;
}): string | null {
  const responsible = (issue.responsibleName || "").trim();
  if (responsible) return responsible;
  const recipient = (issue.actualRecipientName || "").trim();
  return recipient || null;
}

type BalanceLine = { materialId: string; name: string; unit: string; quantity: number };

type BalanceMaps = {
  qtyByKey: Map<string, number>;
  holderLabels: Map<string, string>;
  materialMeta: Map<string, { name: string; unit: string }>;
};

async function buildMaterialReportBalances(
  warehouseId: string,
  section: string
): Promise<BalanceMaps> {
  const qtyByKey = new Map<string, number>();
  const holderLabels = new Map<string, string>([[STOREKEEPER_HOLDER_KEY, STOREKEEPER_HOLDER_NAME]]);
  const materialMeta = new Map<string, { name: string; unit: string }>();

  const rememberMaterial = (id: string, name: string, unit: string) => {
    if (!materialMeta.has(id)) materialMeta.set(id, { name, unit });
  };

  const addQty = (holderKey: string, holderName: string, materialId: string, delta: number) => {
    if (delta <= 0) return;
    if (!holderLabels.has(holderKey)) holderLabels.set(holderKey, holderName);
    const key = composeKey(holderKey, materialId);
    qtyByKey.set(key, (qtyByKey.get(key) || 0) + delta);
  };

  const stocks = await prisma.stock.findMany({
    where: {
      warehouseId,
      section: section as "SS" | "EOM",
      material: { kind: { in: REPORT_MATERIAL_KINDS } }
    },
    select: {
      materialId: true,
      quantity: true,
      material: { select: { id: true, name: true, unit: true } }
    }
  });

  for (const row of stocks) {
    const qty = Number(row.quantity) || 0;
    if (qty < 1e-9) continue;
    rememberMaterial(row.material.id, row.material.name, row.material.unit);
    addQty(STOREKEEPER_HOLDER_KEY, STOREKEEPER_HOLDER_NAME, row.materialId, qty);
  }

  const issues = await prisma.issueRequest.findMany({
    where: {
      warehouseId,
      section: section as "SS" | "EOM",
      status: IssueRequestStatus.ISSUED,
      domain: { in: DOMAINS },
      items: { some: {} }
    },
    select: {
      responsibleName: true,
      actualRecipientName: true,
      approvedById: true,
      requestedById: true,
      items: {
        select: {
          materialId: true,
          quantity: true,
          material: { select: { id: true, name: true, unit: true } }
        }
      }
    }
  });

  const fallbackUserIds = new Set<string>();
  for (const iss of issues) {
    if (!issueResponsibleLabel(iss)) {
      const uid = iss.approvedById || iss.requestedById;
      if (uid) fallbackUserIds.add(uid);
    }
  }

  const fallbackUsers =
    fallbackUserIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...fallbackUserIds] } },
          select: { id: true, fullName: true, email: true }
        })
      : [];
  const userLabel = new Map(fallbackUsers.map((u) => [u.id, u.fullName || u.email || u.id]));

  for (const iss of issues) {
    let holderName = issueResponsibleLabel(iss);
    let holderKey: string;
    if (holderName) {
      holderKey = personHolderKey(holderName);
    } else {
      const uid = iss.approvedById || iss.requestedById;
      if (!uid) continue;
      holderKey = `user:${uid}`;
      holderName = userLabel.get(uid) || uid;
    }

    for (const it of iss.items) {
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      rememberMaterial(it.material.id, it.material.name, it.material.unit);
      addQty(holderKey, holderName, it.materialId, qty);
    }
  }

  const woRows = await prisma.materialHolderWriteoff.groupBy({
    by: ["holderKey", "materialId"],
    where: { warehouseId, section: section as "SS" | "EOM" },
    _sum: { quantity: true }
  });

  for (const w of woRows) {
    const key = composeKey(w.holderKey, w.materialId);
    const cur = qtyByKey.get(key) || 0;
    const sub = Number(w._sum.quantity || 0) || 0;
    qtyByKey.set(key, Math.max(0, cur - sub));
  }

  return { qtyByKey, holderLabels, materialMeta };
}

function balancesToPayload(maps: BalanceMaps) {
  const { qtyByKey, holderLabels, materialMeta } = maps;
  type Line = BalanceLine;
  const holders = new Map<string, Line[]>();

  for (const [key, qty] of qtyByKey.entries()) {
    if (qty < 1e-9) continue;
    const sep = key.lastIndexOf(":");
    const holderKey = key.slice(0, sep);
    const materialId = key.slice(sep + 1);
    const meta = materialMeta.get(materialId) || {
      name: materialId.slice(0, 8),
      unit: "шт"
    };
    const arr = holders.get(holderKey) || [];
    arr.push({ materialId, name: meta.name, unit: meta.unit, quantity: qty });
    holders.set(holderKey, arr);
  }

  const payload = [...holders.entries()].map(([holderKey, lines]) => ({
    holderKey,
    holderUserId: holderKey.startsWith("user:") ? holderKey.slice(5) : null,
    holderName: holderLabels.get(holderKey) || holderKey,
    lines: lines.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }));

  payload.sort((a, b) => {
    if (a.holderKey === STOREKEEPER_HOLDER_KEY) return -1;
    if (b.holderKey === STOREKEEPER_HOLDER_KEY) return 1;
    return String(a.holderName).localeCompare(String(b.holderName), "ru");
  });

  return payload;
}

export const materialReportRouter = Router();
materialReportRouter.use(requireAuth);

materialReportRouter.get("/balances", requirePermission("materialReport.read"), async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : "";
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : "";

  if (!warehouseId || !section) {
    return res.status(400).json({ error: "warehouseId и section (SS|EOM) обязательны" });
  }

  const scope = await getRequestDataScope(req);
  try {
    assertObjectSectionInScope(scope, warehouseId, section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  const maps = await buildMaterialReportBalances(warehouseId, section);
  return res.json(balancesToPayload(maps));
});

materialReportRouter.get("/writeoffs/history", requirePermission("materialReport.read"), async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : "";
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : "";

  const takeRaw = Number(req.query.take);
  const take = Number.isFinite(takeRaw) ? Math.min(200, Math.max(1, takeRaw)) : 80;

  if (!warehouseId || !section) {
    return res.status(400).json({ error: "warehouseId и section (SS|EOM) обязательны" });
  }

  const scope = await getRequestDataScope(req);
  try {
    assertObjectSectionInScope(scope, warehouseId, section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  const rows = await prisma.materialHolderWriteoff.findMany({
    where: { warehouseId, section },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      holderUser: { select: { fullName: true, email: true } },
      actorUser: { select: { fullName: true, email: true } },
      material: { select: { name: true, unit: true } }
    }
  });

  const docIds = [...new Set(rows.map((w) => w.documentFileId).filter((x): x is string => Boolean(x)))];
  const docs =
    docIds.length > 0
      ? await prisma.documentFile.findMany({
          where: { id: { in: docIds }, isDeleted: false },
          select: { id: true, filePath: true, fileName: true }
        })
      : [];
  const docById = new Map(docs.map((d) => [d.id, d]));

  return res.json(
    rows.map((w) => {
      const doc = w.documentFileId ? docById.get(w.documentFileId) : undefined;
      return {
        id: w.id,
        createdAt: w.createdAt,
        quantity: Number(w.quantity),
        comment: w.comment,
        holderName:
          w.holderName || w.holderUser?.fullName || w.holderUser?.email || w.holderKey,
        actorName: w.actorUser.fullName || w.actorUser.email,
        materialName: w.material.name,
        materialUnit: w.material.unit,
        documentFileId: w.documentFileId,
        documentPath: doc?.filePath ?? null,
        documentFileName: doc?.fileName ?? null
      };
    })
  );
});

const writeOffSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  holderKey: z.string().min(1).optional(),
  holderUserId: z.string().min(1).optional(),
  materialId: z.string().min(1),
  quantity: z.number().positive(),
  comment: z.string().max(2000).optional()
});

materialReportRouter.post(
  "/writeoffs",
  requirePermission("materialReport.write"),
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    let body: unknown = {};
    try {
      body = typeof req.body?.payload === "string" ? JSON.parse(req.body.payload) : req.body;
    } catch {
      return res.status(400).json({ error: "Некорректный JSON в payload" });
    }
    const parsed = writeOffSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertObjectSectionInScope(scope, parsed.data.warehouseId, parsed.data.section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }

    const holderKey =
      parsed.data.holderKey?.trim() ||
      (parsed.data.holderUserId ? `user:${parsed.data.holderUserId}` : "");
    if (!holderKey) {
      return res.status(400).json({ error: "holderKey обязателен" });
    }

    const { warehouseId, section, materialId, quantity, comment } = parsed.data;
    const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;

    const maps = await buildMaterialReportBalances(warehouseId, section);
    const holderName = maps.holderLabels.get(holderKey) || holderKey;
    const balance = maps.qtyByKey.get(composeKey(holderKey, materialId)) || 0;

    if (quantity > balance + 1e-6) {
      return res.status(409).json({
        error: "Недостаточно остатка у ответственного",
        balance
      });
    }

    const legacyHolderUserId = holderKey.startsWith("user:") ? holderKey.slice(5) : null;

    const writeoff = await prisma.$transaction(async (tx) => {
      const row = await tx.materialHolderWriteoff.create({
        data: {
          warehouseId,
          section,
          holderKey,
          holderName,
          holderUserId: legacyHolderUserId,
          materialId,
          quantity,
          actorUserId: req.user!.userId,
          comment: comment?.trim() || null
        }
      });

      if (file) {
        const absPath = path.join(uploadDirAbs, file.filename);
        const checksumSha256 = await sha256File(absPath);
        const material = await tx.material.findUnique({
          where: { id: materialId },
          select: { name: true }
        });
        const base = `writeoff-${material?.name || materialId}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
        const relPath = `${config.uploadsDir}/${file.filename}`.replace(/\\/g, "/");
        const doc = await tx.documentFile.create({
          data: {
            groupId: crypto.randomUUID(),
            version: 1,
            entityType: "material-writeoff",
            entityId: row.id,
            type: "signed-act",
            fileName: file.originalname || `${base}.bin`,
            filePath: relPath,
            mimeType: file.mimetype || "application/octet-stream",
            size: file.size,
            checksumSha256,
            createdBy: req.user!.userId
          }
        });
        await tx.materialHolderWriteoff.update({
          where: { id: row.id },
          data: { documentFileId: doc.id }
        });
      }

      return row;
    });

    await recordAudit({
      userId: req.user!.userId,
      action: "MATERIAL_HOLDER_WRITEOFF",
      entityType: "MaterialHolderWriteoff",
      entityId: writeoff.id,
      summary: `Списание с ответственного · ${holderName} · материал ${materialId} · ${quantity}`,
      after: { warehouseId, section, holderKey, holderName, materialId, quantity }
    });

    return res.status(201).json({ id: writeoff.id });
  }
);
