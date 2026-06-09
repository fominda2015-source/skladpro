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
import {
  assertObjectSectionInScope,
  assertWarehouseInScope,
  getRequestDataScope,
  resolveReadScope
} from "../lib/dataScope.js";
import { sha256File } from "../lib/fileHash.js";
import { prisma } from "../lib/prisma.js";
import { materialQtySchema } from "../lib/quantity.js";
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

/** Руководители не участвуют в материальном отчёте. */
const MATERIAL_REPORT_EXCLUDED_ROLES = ["PROJECT_MANAGER", "MANAGEMENT"] as const;

const STOREKEEPER_POSITION_NAMES = ["Кладовщик"];

function molUserWarehouseFilter(warehouseId: string, section?: "SS" | "EOM") {
  return {
    status: "ACTIVE" as const,
    isMol: true,
    role: { name: { notIn: [...MATERIAL_REPORT_EXCLUDED_ROLES] } },
    OR: [
      { warehouseScopes: { some: { warehouseId } } },
      {
        warehouseSectionScopes: {
          some: section ? { warehouseId, section } : { warehouseId }
        }
      }
    ]
  };
}

async function resolveWarehouseMolHolder(
  warehouseId: string,
  section: "SS" | "EOM"
): Promise<{ userId: string; fullName: string } | null> {
  const users = await prisma.user.findMany({
    where: molUserWarehouseFilter(warehouseId),
    select: {
      id: true,
      fullName: true,
      email: true,
      position: { select: { name: true } },
      warehouseSectionScopes: { where: { warehouseId }, select: { section: true } }
    },
    orderBy: { fullName: "asc" }
  });

  if (!users.length) return null;

  const storekeepers = users.filter((u) =>
    STOREKEEPER_POSITION_NAMES.includes(u.position?.name || "")
  );
  const pool = storekeepers.length ? storekeepers : users;
  const sectionMatched = pool.filter((u) =>
    u.warehouseSectionScopes.some((s) => s.section === section)
  );
  const pick = (sectionMatched.length ? sectionMatched : pool)[0]!;
  return {
    userId: pick.id,
    fullName: (pick.fullName || pick.email || pick.id).trim()
  };
}

function warehouseStockHolderKey(holder: { userId: string } | null): string | null {
  return holder ? `user:${holder.userId}` : null;
}

function normalizeLegacyHolderKey(
  holderKey: string,
  warehouseStockKey: string
): string {
  if (
    holderKey === STOREKEEPER_HOLDER_KEY &&
    warehouseStockKey &&
    warehouseStockKey !== STOREKEEPER_HOLDER_KEY
  ) {
    return warehouseStockKey;
  }
  return holderKey;
}

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

const WAREHOUSE_STOCK_ISSUE_ID = "__warehouse_stock__";

type IssueGroupMeta = {
  issueId: string;
  issueNumber: string;
  issuedAt: string;
  warehouseId: string;
  section: "SS" | "EOM";
};

type BalanceMaps = {
  qtyByKey: Map<string, number>;
  holderLabels: Map<string, string>;
  materialMeta: Map<string, { name: string; unit: string }>;
  warehouseStockHolderKey: string;
  holderIssueMeta: Map<string, { issueNumbers: string[]; lastIssueAt: string | null }>;
  /** holderKey → issueId → lines (выдано по заявкам) */
  holderIssueLines: Map<string, Map<string, { meta: IssueGroupMeta; lines: Map<string, BalanceLine> }>>;
};

function emptyBalanceMaps(warehouseStockHolderKey: string | null): BalanceMaps {
  return {
    qtyByKey: new Map(),
    holderLabels: new Map(),
    materialMeta: new Map(),
    warehouseStockHolderKey: warehouseStockHolderKey ?? "",
    holderIssueMeta: new Map(),
    holderIssueLines: new Map()
  };
}

function mergeBalanceMaps(target: BalanceMaps, source: BalanceMaps) {
  for (const [k, v] of source.holderLabels) target.holderLabels.set(k, v);
  for (const [k, v] of source.materialMeta) target.materialMeta.set(k, v);
  for (const [k, v] of source.qtyByKey) {
    target.qtyByKey.set(k, (target.qtyByKey.get(k) || 0) + v);
  }
  for (const [holderKey, meta] of source.holderIssueMeta) {
    const prev = target.holderIssueMeta.get(holderKey) ?? { issueNumbers: [], lastIssueAt: null };
    for (const n of meta.issueNumbers) {
      if (!prev.issueNumbers.includes(n)) prev.issueNumbers.push(n);
    }
    if (meta.lastIssueAt && (!prev.lastIssueAt || meta.lastIssueAt > prev.lastIssueAt)) {
      prev.lastIssueAt = meta.lastIssueAt;
    }
    target.holderIssueMeta.set(holderKey, prev);
  }
  for (const [holderKey, byIssue] of source.holderIssueLines) {
    const tgtByIssue = target.holderIssueLines.get(holderKey) ?? new Map();
    for (const [issueId, grp] of byIssue) {
      const existing = tgtByIssue.get(issueId);
      if (!existing) {
        tgtByIssue.set(issueId, {
          meta: { ...grp.meta },
          lines: new Map(grp.lines)
        });
        continue;
      }
      for (const [matId, line] of grp.lines) {
        const prev = existing.lines.get(matId);
        if (prev) prev.quantity += line.quantity;
        else existing.lines.set(matId, { ...line });
      }
    }
    target.holderIssueLines.set(holderKey, tgtByIssue);
  }
}

async function resolveMaterialReportTargets(
  scope: Awaited<ReturnType<typeof resolveReadScope>>,
  warehouseId: string,
  sectionFilter: "SS" | "EOM" | "ALL"
): Promise<Array<{ warehouseId: string; section: "SS" | "EOM" }>> {
  const warehouseIds = warehouseId
    ? [warehouseId]
    : scope.unrestricted
      ? (await prisma.warehouse.findMany({ select: { id: true } })).map((w) => w.id)
      : [...(scope.warehouseIds || [])];
  const sections: Array<"SS" | "EOM"> = sectionFilter === "ALL" ? ["SS", "EOM"] : [sectionFilter];
  const pairs: Array<{ warehouseId: string; section: "SS" | "EOM" }> = [];
  for (const wid of warehouseIds) {
    for (const section of sections) {
      try {
        assertObjectSectionInScope(scope, wid, section);
        pairs.push({ warehouseId: wid, section });
      } catch {
        // skip forbidden warehouse/section pairs
      }
    }
  }
  return pairs;
}

async function buildAggregatedMaterialReportBalances(
  scope: Awaited<ReturnType<typeof resolveReadScope>>,
  warehouseId: string,
  sectionFilter: "SS" | "EOM" | "ALL"
): Promise<BalanceMaps> {
  const targets = await resolveMaterialReportTargets(scope, warehouseId, sectionFilter);
  if (!targets.length) {
    return emptyBalanceMaps(null);
  }
  let merged: BalanceMaps | null = null;
  for (const t of targets) {
    const maps = await buildMaterialReportBalances(t.warehouseId, t.section);
    if (!merged) merged = maps;
    else mergeBalanceMaps(merged, maps);
  }
  return merged ?? emptyBalanceMaps(null);
}

async function buildMaterialReportBalances(
  warehouseId: string,
  section: string
): Promise<BalanceMaps> {
  const sectionEnum = section as "SS" | "EOM";
  const molHolder = await resolveWarehouseMolHolder(warehouseId, sectionEnum);
  const whHolderKey = warehouseStockHolderKey(molHolder);
  const whHolderName = molHolder?.fullName ?? "";

  const qtyByKey = new Map<string, number>();
  const holderLabels = new Map<string, string>();
  if (whHolderKey && whHolderName) {
    holderLabels.set(whHolderKey, whHolderName);
  }
  const materialMeta = new Map<string, { name: string; unit: string }>();
  const holderIssueMeta = new Map<string, { issueNumbers: string[]; lastIssueAt: string | null }>();
  const holderIssueLines = new Map<
    string,
    Map<string, { meta: IssueGroupMeta; lines: Map<string, BalanceLine> }>
  >();

  const addIssueLine = (
    holderKey: string,
    meta: IssueGroupMeta,
    materialId: string,
    name: string,
    unit: string,
    delta: number
  ) => {
    if (delta <= 0) return;
    const byIssue = holderIssueLines.get(holderKey) ?? new Map();
    let grp = byIssue.get(meta.issueId);
    if (!grp) {
      grp = { meta: { ...meta }, lines: new Map() };
      byIssue.set(meta.issueId, grp);
    }
    const prev = grp.lines.get(materialId);
    if (prev) prev.quantity += delta;
    else grp.lines.set(materialId, { materialId, name, unit, quantity: delta });
    holderIssueLines.set(holderKey, byIssue);
  };

  const trackIssue = (holderKey: string, issueNumber: string, issuedAt: Date) => {
    const prev = holderIssueMeta.get(holderKey) ?? { issueNumbers: [], lastIssueAt: null };
    if (!prev.issueNumbers.includes(issueNumber)) prev.issueNumbers.push(issueNumber);
    const at = issuedAt.toISOString();
    if (!prev.lastIssueAt || at > prev.lastIssueAt) prev.lastIssueAt = at;
    holderIssueMeta.set(holderKey, prev);
  };

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

  const stockIssueMeta: IssueGroupMeta = {
    issueId: WAREHOUSE_STOCK_ISSUE_ID,
    issueNumber: "Остаток на складе",
    issuedAt: new Date(0).toISOString(),
    warehouseId,
    section: sectionEnum
  };

  if (whHolderKey && whHolderName) {
    for (const row of stocks) {
      const qty = Number(row.quantity) || 0;
      if (qty < 1e-9) continue;
      rememberMaterial(row.material.id, row.material.name, row.material.unit);
      addQty(whHolderKey, whHolderName, row.materialId, qty);
      addIssueLine(
        whHolderKey,
        stockIssueMeta,
        row.materialId,
        row.material.name,
        row.material.unit,
        qty
      );
    }
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
      id: true,
      number: true,
      updatedAt: true,
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

    const issueMeta: IssueGroupMeta = {
      issueId: iss.id,
      issueNumber: iss.number,
      issuedAt: iss.updatedAt.toISOString(),
      warehouseId,
      section: sectionEnum
    };
    for (const it of iss.items) {
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      rememberMaterial(it.material.id, it.material.name, it.material.unit);
      addQty(holderKey, holderName, it.materialId, qty);
      addIssueLine(
        holderKey,
        issueMeta,
        it.materialId,
        it.material.name,
        it.material.unit,
        qty
      );
    }
    trackIssue(holderKey, iss.number, iss.updatedAt);
  }

  const woRows = await prisma.materialHolderWriteoff.groupBy({
    by: ["holderKey", "materialId"],
    where: { warehouseId, section: section as "SS" | "EOM" },
    _sum: { quantity: true }
  });

  for (const w of woRows) {
    const holderKey = normalizeLegacyHolderKey(w.holderKey, whHolderKey || "");
    const key = composeKey(holderKey, w.materialId);
    const cur = qtyByKey.get(key) || 0;
    const sub = Number(w._sum.quantity || 0) || 0;
    qtyByKey.set(key, Math.max(0, cur - sub));
  }

  return {
    qtyByKey,
    holderLabels,
    materialMeta,
    warehouseStockHolderKey: whHolderKey || "",
    holderIssueMeta,
    holderIssueLines
  };
}

function balancesToPayload(maps: BalanceMaps) {
  const { qtyByKey, holderLabels, materialMeta, warehouseStockHolderKey, holderIssueMeta, holderIssueLines } =
    maps;
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

  const payload = [...holders.entries()].map(([holderKey, lines]) => {
    const meta = holderIssueMeta.get(holderKey);
    const issueMap = holderIssueLines.get(holderKey);
    const issues = issueMap
      ? [...issueMap.values()]
          .map((grp) => ({
            issueId: grp.meta.issueId,
            issueNumber: grp.meta.issueNumber,
            issuedAt: grp.meta.issuedAt,
            warehouseId: grp.meta.warehouseId,
            section: grp.meta.section,
            lines: [...grp.lines.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
          }))
          .filter((g) => g.lines.length > 0)
          .sort((a, b) => {
            if (a.issueId === WAREHOUSE_STOCK_ISSUE_ID) return -1;
            if (b.issueId === WAREHOUSE_STOCK_ISSUE_ID) return 1;
            return new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime();
          })
      : [];
    return {
      holderKey,
      holderUserId: holderKey.startsWith("user:") ? holderKey.slice(5) : null,
      holderName: holderLabels.get(holderKey) || holderKey,
      isWarehouseBalance: Boolean(warehouseStockHolderKey) && holderKey === warehouseStockHolderKey,
      issueNumbers: meta?.issueNumbers ?? [],
      lastIssueAt: meta?.lastIssueAt ?? null,
      issues,
      lines: lines.sort((a, b) => a.name.localeCompare(b.name, "ru"))
    };
  });

  const filtered = payload.filter(
    (row) => row.holderKey !== STOREKEEPER_HOLDER_KEY && row.lines.length > 0
  );

  filtered.sort((a, b) => {
    if (a.isWarehouseBalance) return -1;
    if (b.isWarehouseBalance) return 1;
    return String(a.holderName).localeCompare(String(b.holderName), "ru");
  });

  return filtered;
}

async function listMaterialReportMolUsers(
  warehouseId: string,
  sectionFilter: "SS" | "EOM" | "ALL"
) {
  const section =
    sectionFilter === "SS" || sectionFilter === "EOM" ? sectionFilter : undefined;
  const rows = await prisma.user.findMany({
    where: molUserWarehouseFilter(warehouseId, section),
    include: { role: true, position: true },
    orderBy: { fullName: "asc" }
  });
  return rows.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    avatarUrl: u.avatarUrl,
    position: u.position?.name || null,
    role: u.role.name,
    isMol: u.isMol
  }));
}

export const materialReportRouter = Router();
materialReportRouter.use(requireAuth);

materialReportRouter.get("/mol-users", requirePermission("materialReport.read"), async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  if (!warehouseId) {
    return res.status(400).json({ error: "warehouseId обязателен" });
  }
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "ALL";
  if (sectionRaw && sectionRaw !== "SS" && sectionRaw !== "EOM" && sectionRaw !== "ALL") {
    return res.status(400).json({ error: "section: SS, EOM или ALL" });
  }
  const sectionFilter: "SS" | "EOM" | "ALL" =
    sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : "ALL";

  const scope = await resolveReadScope(req, { warehouseId });
  try {
    assertWarehouseInScope(scope, warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  return res.json(await listMaterialReportMolUsers(warehouseId, sectionFilter));
});

materialReportRouter.get("/balances", requirePermission("materialReport.read"), async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "ALL";
  if (sectionRaw && sectionRaw !== "SS" && sectionRaw !== "EOM" && sectionRaw !== "ALL") {
    return res.status(400).json({ error: "section: SS, EOM или ALL" });
  }
  const sectionFilter: "SS" | "EOM" | "ALL" =
    sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : "ALL";

  const scope = await resolveReadScope(req, warehouseId ? { warehouseId } : undefined);
  if (warehouseId) {
    try {
      assertWarehouseInScope(scope, warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
  }

  const maps = await buildAggregatedMaterialReportBalances(scope, warehouseId, sectionFilter);
  return res.json(balancesToPayload(maps));
});

materialReportRouter.get("/writeoffs/history", requirePermission("materialReport.read"), async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "ALL";
  if (sectionRaw && sectionRaw !== "SS" && sectionRaw !== "EOM" && sectionRaw !== "ALL") {
    return res.status(400).json({ error: "section: SS, EOM или ALL" });
  }
  const sectionFilter: "SS" | "EOM" | "ALL" =
    sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : "ALL";
  const holderKey = typeof req.query.holderKey === "string" ? req.query.holderKey.trim() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const fromRaw = typeof req.query.from === "string" ? req.query.from : "";
  const toRaw = typeof req.query.to === "string" ? req.query.to : "";

  const takeRaw = Number(req.query.take);
  const take = Number.isFinite(takeRaw) ? Math.min(500, Math.max(1, takeRaw)) : 200;

  const scope = await resolveReadScope(req, warehouseId ? { warehouseId } : undefined);
  if (warehouseId) {
    try {
      assertWarehouseInScope(scope, warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
  }

  const targets = await resolveMaterialReportTargets(scope, warehouseId, sectionFilter);
  if (!targets.length) {
    return res.json([]);
  }

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (fromRaw) {
    const d = new Date(fromRaw);
    if (!Number.isNaN(d.getTime())) createdAt.gte = d;
  }
  if (toRaw) {
    const d = new Date(toRaw);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      createdAt.lte = d;
    }
  }

  const rows = await prisma.materialHolderWriteoff.findMany({
    where: {
      OR: targets.map((t) => ({
        warehouseId: t.warehouseId,
        section: t.section
      })),
      ...(holderKey ? { holderKey } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(q
        ? {
            OR: [
              { holderName: { contains: q, mode: "insensitive" } },
              { comment: { contains: q, mode: "insensitive" } },
              { material: { name: { contains: q, mode: "insensitive" } } },
              { actorUser: { fullName: { contains: q, mode: "insensitive" } } }
            ]
          }
        : {})
    },
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
        holderKey: w.holderKey,
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
  quantity: materialQtySchema,
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

    const { warehouseId, section, materialId, quantity, comment } = parsed.data;

    const maps = await buildMaterialReportBalances(warehouseId, section);
    let holderKey =
      parsed.data.holderKey?.trim() ||
      (parsed.data.holderUserId ? `user:${parsed.data.holderUserId}` : "");
    holderKey = normalizeLegacyHolderKey(holderKey, maps.warehouseStockHolderKey || "");
    if (!holderKey) {
      return res.status(400).json({ error: "holderKey обязателен" });
    }

    const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;

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
