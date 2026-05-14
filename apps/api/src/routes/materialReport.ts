import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { Router } from "express";
import multer from "multer";
import { IssueRequestDomain, IssueRequestStatus } from "@prisma/client";
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

function composeKey(holderUserId: string, materialId: string) {
  return `${holderUserId}:${materialId}`;
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

  const issues = await prisma.issueRequest.findMany({
    where: {
      warehouseId,
      section,
      status: IssueRequestStatus.ISSUED,
      domain: { in: DOMAINS },
      items: { some: {} }
    },
    select: {
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

  const issuedByKey = new Map<string, number>();
  for (const iss of issues) {
    const holder = iss.approvedById || iss.requestedById;
    if (!holder) continue;
    for (const it of iss.items) {
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      const key = composeKey(holder, it.materialId);
      issuedByKey.set(key, (issuedByKey.get(key) || 0) + qty);
    }
  }

  const woRows = await prisma.materialHolderWriteoff.groupBy({
    by: ["holderUserId", "materialId"],
    where: { warehouseId, section },
    _sum: { quantity: true }
  });

  for (const w of woRows) {
    const key = composeKey(w.holderUserId, w.materialId);
    const cur = issuedByKey.get(key) || 0;
    const sub = Number(w._sum.quantity || 0) || 0;
    issuedByKey.set(key, Math.max(0, cur - sub));
  }

  const materialIds = new Set<string>();
  for (const [key, qty] of issuedByKey.entries()) {
    if (qty < 1e-9) continue;
    materialIds.add(key.split(":")[1]!);
  }

  const materials =
    materialIds.size > 0
      ? await prisma.material.findMany({
          where: { id: { in: [...materialIds] } },
          select: { id: true, name: true, unit: true }
        })
      : [];
  const materialMeta = new Map(materials.map((m) => [m.id, { name: m.name, unit: m.unit }]));

  const holderIds = new Set<string>();
  for (const key of issuedByKey.keys()) {
    if ((issuedByKey.get(key) || 0) < 1e-9) continue;
    holderIds.add(key.split(":")[0]!);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...holderIds] } },
    select: { id: true, fullName: true, email: true }
  });
  const userLabel = new Map(users.map((u) => [u.id, u.fullName || u.email]));

  type Line = { materialId: string; name: string; unit: string; quantity: number };
  const holders = new Map<string, Line[]>();

  for (const [key, qty] of issuedByKey.entries()) {
    if (qty < 1e-9) continue;
    const [holderUserId, materialId] = key.split(":") as [string, string];
    const meta = materialMeta.get(materialId) || {
      name: materialId.slice(0, 8),
      unit: "шт"
    };
    const arr = holders.get(holderUserId) || [];
    arr.push({ materialId, name: meta.name, unit: meta.unit, quantity: qty });
    holders.set(holderUserId, arr);
  }

  const payload = [...holders.entries()].map(([holderUserId, lines]) => ({
    holderUserId,
    holderName: userLabel.get(holderUserId) || holderUserId,
    lines: lines.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }));

  payload.sort((a, b) => String(a.holderName).localeCompare(String(b.holderName), "ru"));

  return res.json(payload);
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
        holderName: w.holderUser.fullName || w.holderUser.email,
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
  holderUserId: z.string().min(1),
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

    const { warehouseId, section, holderUserId, materialId, quantity, comment } = parsed.data;
    const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;

    const issues = await prisma.issueRequest.findMany({
      where: {
        warehouseId,
        section,
        status: IssueRequestStatus.ISSUED,
        domain: { in: DOMAINS },
        items: { some: { materialId } }
      },
      select: {
        approvedById: true,
        requestedById: true,
        items: { where: { materialId }, select: { quantity: true } }
      }
    });

    let issued = 0;
    for (const iss of issues) {
      const holder = iss.approvedById || iss.requestedById;
      if (holder !== holderUserId) continue;
      for (const it of iss.items) {
        issued += Number(it.quantity) || 0;
      }
    }

    const writtenOff = await prisma.materialHolderWriteoff.aggregate({
      where: { warehouseId, section, holderUserId, materialId },
      _sum: { quantity: true }
    });
    const already = Number(writtenOff._sum.quantity || 0) || 0;
    const balance = Math.max(0, issued - already);

    if (quantity > balance + 1e-6) {
      return res.status(409).json({
        error: "Недостаточно остатка у ответственного",
        balance
      });
    }

    const writeoff = await prisma.$transaction(async (tx) => {
      const row = await tx.materialHolderWriteoff.create({
        data: {
          warehouseId,
          section,
          holderUserId,
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
      summary: `Списание с ответственного · материал ${materialId} · ${quantity}`,
      after: { warehouseId, section, holderUserId, materialId, quantity }
    });

    return res.status(201).json({ id: writeoff.id });
  }
);
