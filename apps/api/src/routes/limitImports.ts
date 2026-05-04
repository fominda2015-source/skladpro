import multer from "multer";
import { Router } from "express";
import xlsx from "xlsx";
import { z } from "zod";
import type { LimitNodeType, Prisma } from "@prisma/client";
import {
  assertObjectSectionInScope,
  getRequestDataScope,
  objectLimitTemplateWhereFromScope
} from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const importQuerySchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  title: z.string().min(2).max(200).optional()
});

type FlatNode = {
  level: number;
  title: string;
  nodeType: "GROUP" | "MATERIAL";
  indexLabel?: string;
  materialName?: string;
  unit?: string;
  plannedQty?: number;
};

function parseLimitSheet(file: Buffer): FlatNode[] {
  const wb = xlsx.read(file, { type: "buffer", cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<Array<string | number | null>>(ws, {
    header: 1,
    raw: false,
    blankrows: false
  });
  const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const looksLikeWork = (nameRaw: string) => {
    const s = nameRaw.trim().toLowerCase();
    if (!s) return false;
    // В ТКП встречаются строки работ (монтаж/прокладка/наладка/испытания) — их исключаем из лимитов.
    return (
      s.startsWith("монтаж ") ||
      s.startsWith("прокладка ") ||
      s.startsWith("демонтаж ") ||
      s.includes("пуско-налад") ||
      s.includes("пуско налад") ||
      s.includes("наладоч") ||
      s.includes("испытан") ||
      s.includes("настройк")
    );
  };

  // Поддерживаем 2 формата:
  // 1) "эталон" (как в файле "материалы_и_заголовки"): A=№, B=Тип, C=Наименование, E=Ед.изм, F=Коэф.расхода
  // 2) "боевой ТКП": B=номер п/п, C=Наименование затрат, E=Ед. изм., F=Коэф.расхода
  let format: "ETALON" | "TKP" = "ETALON";
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const r = rows[i] || [];
    const a = norm(r[0]);
    const b = norm(r[1]);
    const c = norm(r[2]);
    const e = norm(r[4]);
    const f = norm(r[5]);
    if (a === "№" && b.toLowerCase() === "тип" && c.toLowerCase().includes("наимен")) {
      format = "ETALON";
      break;
    }
    if (b.toLowerCase().includes("номер") && c.toLowerCase().includes("наимен") && e.toLowerCase().includes("ед") && f.toLowerCase().includes("коэф")) {
      format = "TKP";
      break;
    }
  }

  const out: FlatNode[] = [];
  let activeTop = "";
  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const idx = format === "ETALON" ? norm(row[0]) : norm(row[1]);
    const type = format === "ETALON" ? norm(row[1]) : "";
    const name = format === "ETALON" ? norm(row[2]) : norm(row[2]);
    const unit = format === "ETALON" ? norm(row[4]) : norm(row[4]);
    // В эталонном файле план берем из F (Коэф. расхода).
    // В боевом ТКП плановое количество лежит в G (Кол-во).
    const qtyRaw = (format === "ETALON" ? norm(row[5]) : norm(row[6])).replace(",", ".");
    const qty = qtyRaw ? Number(qtyRaw) : Number.NaN;

    if (!name) continue;

    // Пропускаем служебные строки шапки
    const nameLower = name.toLowerCase();
    if (nameLower.includes("технико-коммерческое предложение") || nameLower.includes("указать название организации")) {
      continue;
    }

    // Явная типизация из эталонного файла
    if (format === "ETALON") {
      if (type.toLowerCase().includes("заголовок")) {
        out.push({ level: idx.includes(".") ? 1 : 0, title: name, indexLabel: idx, nodeType: "GROUP" });
        if (!idx.includes(".")) activeTop = idx;
        continue;
      }
      if (type.toLowerCase().includes("подзаголовок")) {
        out.push({ level: 1, title: name, indexLabel: idx, nodeType: "GROUP" });
        continue;
      }
      if (type.toLowerCase().includes("материал")) {
        if (looksLikeWork(name)) continue;
        out.push({
          level: 2,
          title: name,
          nodeType: "MATERIAL",
          materialName: name,
          unit: unit || undefined,
          plannedQty: Number.isFinite(qty) ? qty : undefined
        });
        continue;
      }
    }

    // Не-эталон (боевой ТКП) — определяем по заполненности unit/qty и номеру
    if (idx && idx !== "" && unit === "" && Number.isNaN(qty)) {
      activeTop = idx;
      out.push({ level: 0, title: name, indexLabel: idx, nodeType: "GROUP" });
      continue;
    }
    if (unit === "" && Number.isNaN(qty)) {
      out.push({ level: activeTop ? 1 : 0, title: name, indexLabel: activeTop || undefined, nodeType: "GROUP" });
      continue;
    }
    if (looksLikeWork(name)) {
      continue;
    }
    out.push({
      level: activeTop ? 2 : 1,
      title: name,
      nodeType: "MATERIAL",
      materialName: name,
      unit: unit || undefined,
      plannedQty: Number.isFinite(qty) ? qty : undefined
    });
  }
  return out;
}

async function findOrCreateMaterialId(
  tx: Prisma.TransactionClient,
  nameRaw: string,
  unitRaw: string | undefined | null
): Promise<string | undefined> {
  const name = String(nameRaw || "").trim();
  if (!name) return undefined;
  const unit = String(unitRaw || "шт").trim() || "шт";
  const existing = await tx.material.findFirst({ where: { name, unit } });
  if (existing) return existing.id;
  const created = await tx.material.create({ data: { name, unit } });
  return created.id;
}

const patchTemplateSchema = z.object({
  title: z.string().min(1).max(200).optional()
});

const createNodeSchema = z.object({
  parentId: z.string().nullable().optional(),
  nodeType: z.enum(["GROUP", "MATERIAL"]),
  title: z.string().min(1).max(500),
  materialName: z.string().max(500).nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  plannedQty: z.union([z.number(), z.null()]).optional(),
  indexLabel: z.string().max(50).nullable().optional()
});

const patchNodeSchema = z.object({
  parentId: z.string().nullable().optional(),
  nodeType: z.enum(["GROUP", "MATERIAL"]).optional(),
  title: z.string().min(1).max(500).optional(),
  materialName: z.string().max(500).nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  plannedQty: z.union([z.number(), z.null()]).optional(),
  indexLabel: z.string().max(50).nullable().optional(),
  orderNo: z.number().int().min(0).max(1_000_000).optional()
});

export const limitImportsRouter = Router();
limitImportsRouter.use(requireAuth);
limitImportsRouter.use(requirePermission("limits.read"));

limitImportsRouter.post(
  "/upload",
  requirePermission("limits.write"),
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const parsed = importQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "file is required" });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertObjectSectionInScope(scope, parsed.data.warehouseId, parsed.data.section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    const nodes = parseLimitSheet(req.file.buffer);
    const title = parsed.data.title?.trim() || `Лимиты ${new Date().toLocaleDateString("ru-RU")}`;
    const created = await prisma.$transaction(async (tx) => {
      const tpl = await tx.objectLimitTemplate.create({
        data: {
          warehouseId: parsed.data.warehouseId,
          section: parsed.data.section,
          title,
          sourceFileName: req.file!.originalname,
          createdById: req.user!.userId
        }
      });
      const parentByLevel = new Map<number, string>();
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        let materialId: string | undefined = undefined;
        if (n.nodeType === "MATERIAL") {
          const name = String(n.materialName || n.title || "").trim();
          const unit = String(n.unit || "шт").trim() || "шт";
          if (name) {
            const existing = await tx.material.findFirst({ where: { name, unit } });
            if (existing) {
              materialId = existing.id;
            } else {
              const createdMaterial = await tx.material.create({ data: { name, unit } });
              materialId = createdMaterial.id;
            }
          }
        }
        const row = await tx.objectLimitNode.create({
          data: {
            templateId: tpl.id,
            parentId: n.level > 0 ? parentByLevel.get(n.level - 1) || null : null,
            orderNo: i,
            nodeType: n.nodeType,
            indexLabel: n.indexLabel,
            title: n.title,
            materialName: n.materialName,
            unit: n.unit,
            plannedQty: n.plannedQty,
            ...(materialId ? { materialId } : {})
          }
        });
        parentByLevel.set(n.level, row.id);
      }
      return tpl;
    });
    return res.status(201).json({ id: created.id, nodes: nodes.length });
  }
);

limitImportsRouter.patch(
  "/nodes/:nodeId",
  requirePermission("limits.write"),
  async (req: AuthedRequest, res) => {
    const nodeId = String(req.params.nodeId);
    const parsed = patchNodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const existing = await prisma.objectLimitNode.findUnique({
      where: { id: nodeId },
      include: { template: true }
    });
    if (!existing) {
      return res.status(404).json({ error: "Limit node not found" });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertObjectSectionInScope(scope, existing.template.warehouseId, existing.template.section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }

    const nextType = (parsed.data.nodeType ?? existing.nodeType) as LimitNodeType;
    let title = parsed.data.title ?? existing.title;
    let materialName =
      parsed.data.materialName !== undefined ? parsed.data.materialName : existing.materialName;
    let unit = parsed.data.unit !== undefined ? parsed.data.unit : existing.unit;
    let indexLabel = parsed.data.indexLabel !== undefined ? parsed.data.indexLabel : existing.indexLabel;
    let parentId = parsed.data.parentId !== undefined ? parsed.data.parentId : existing.parentId;
    let orderNo = parsed.data.orderNo !== undefined ? parsed.data.orderNo : existing.orderNo;
    let plannedQty: number | null | undefined =
      parsed.data.plannedQty !== undefined ? parsed.data.plannedQty : undefined;

    if (nextType === "GROUP") {
      materialName = null;
      unit = null;
      plannedQty = null;
    } else {
      const matTitle = String(materialName || title || "").trim();
      if (!matTitle) {
        return res.status(400).json({ error: "MATERIAL node requires materialName or title" });
      }
      materialName = matTitle;
      title = parsed.data.title !== undefined ? String(parsed.data.title).trim() : matTitle;
    }

    if (parentId) {
      const parent = await prisma.objectLimitNode.findFirst({
        where: { id: parentId, templateId: existing.templateId }
      });
      if (!parent) {
        return res.status(400).json({ error: "parentId must belong to the same template" });
      }
      if (parentId === nodeId) {
        return res.status(400).json({ error: "parentId cannot be the node itself" });
      }
      const descendants = new Set<string>();
      const stack = [nodeId];
      while (stack.length) {
        const cur = stack.pop()!;
        const kids = await prisma.objectLimitNode.findMany({
          where: { parentId: cur },
          select: { id: true }
        });
        for (const k of kids) {
          descendants.add(k.id);
          stack.push(k.id);
        }
      }
      if (descendants.has(parentId)) {
        return res.status(400).json({ error: "Cannot move node under its descendant" });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      let materialId: string | null = null;
      if (nextType === "MATERIAL") {
        const resolved = await findOrCreateMaterialId(tx, String(materialName || title), unit);
        materialId = resolved ?? null;
      }

      return tx.objectLimitNode.update({
        where: { id: nodeId },
        data: {
          parentId,
          orderNo,
          nodeType: nextType,
          title,
          materialName: nextType === "MATERIAL" ? materialName : null,
          unit: nextType === "MATERIAL" ? unit : null,
          plannedQty:
            nextType === "GROUP"
              ? null
              : plannedQty === undefined
                ? existing.plannedQty
                : plannedQty === null
                  ? null
                  : plannedQty,
          indexLabel,
          materialId: nextType === "MATERIAL" ? materialId : null
        }
      });
    });

    return res.json(updated);
  }
);

limitImportsRouter.delete(
  "/nodes/:nodeId",
  requirePermission("limits.write"),
  async (req: AuthedRequest, res) => {
    const nodeId = String(req.params.nodeId);
    const existing = await prisma.objectLimitNode.findUnique({
      where: { id: nodeId },
      include: { template: true }
    });
    if (!existing) {
      return res.status(404).json({ error: "Limit node not found" });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertObjectSectionInScope(scope, existing.template.warehouseId, existing.template.section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    await prisma.objectLimitNode.delete({ where: { id: nodeId } });
    return res.status(204).end();
  }
);

limitImportsRouter.post(
  "/:templateId/nodes",
  requirePermission("limits.write"),
  async (req: AuthedRequest, res) => {
    const templateId = String(req.params.templateId);
    const parsed = createNodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const tpl = await prisma.objectLimitTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) {
      return res.status(404).json({ error: "Limit template not found" });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertObjectSectionInScope(scope, tpl.warehouseId, tpl.section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }

    const parentId = parsed.data.parentId ?? null;
    if (parentId) {
      const parent = await prisma.objectLimitNode.findFirst({
        where: { id: parentId, templateId }
      });
      if (!parent) {
        return res.status(400).json({ error: "parentId must belong to this template" });
      }
    }

    const maxOrder = await prisma.objectLimitNode.aggregate({
      where: { templateId, parentId },
      _max: { orderNo: true }
    });
    const orderNo = (maxOrder._max.orderNo ?? -1) + 1;

    const nodeType = parsed.data.nodeType as LimitNodeType;
    let title = parsed.data.title.trim();
    let materialName: string | null = parsed.data.materialName ?? null;
    let unit: string | null = parsed.data.unit ?? null;
    let plannedQty: number | null = parsed.data.plannedQty ?? null;
    let indexLabel: string | null = parsed.data.indexLabel ?? null;

    if (nodeType === "GROUP") {
      materialName = null;
      unit = null;
      plannedQty = null;
    } else {
      const matTitle = String(materialName || title).trim();
      if (!matTitle) {
        return res.status(400).json({ error: "MATERIAL node requires materialName or title" });
      }
      materialName = matTitle;
      title = title || matTitle;
    }

    const created = await prisma.$transaction(async (tx) => {
      let materialId: string | undefined;
      if (nodeType === "MATERIAL") {
        materialId = await findOrCreateMaterialId(tx, String(materialName), unit);
      }
      return tx.objectLimitNode.create({
        data: {
          templateId,
          parentId,
          orderNo,
          nodeType,
          indexLabel,
          title,
          materialName: nodeType === "MATERIAL" ? materialName : null,
          unit: nodeType === "MATERIAL" ? unit : null,
          plannedQty: nodeType === "MATERIAL" ? plannedQty : null,
          ...(nodeType === "MATERIAL" && materialId ? { materialId } : {})
        }
      });
    });

    return res.status(201).json(created);
  }
);

limitImportsRouter.patch(
  "/:templateId",
  requirePermission("limits.write"),
  async (req: AuthedRequest, res) => {
    const templateId = String(req.params.templateId);
    const parsed = patchTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const tpl = await prisma.objectLimitTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) {
      return res.status(404).json({ error: "Limit template not found" });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertObjectSectionInScope(scope, tpl.warehouseId, tpl.section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    if (!parsed.data.title) {
      return res.status(400).json({ error: "Nothing to update" });
    }
    const updated = await prisma.objectLimitTemplate.update({
      where: { id: templateId },
      data: { title: parsed.data.title.trim() }
    });
    return res.json(updated);
  }
);

limitImportsRouter.delete(
  "/:templateId",
  requirePermission("limits.write"),
  async (req: AuthedRequest, res) => {
    const templateId = String(req.params.templateId);
    const tpl = await prisma.objectLimitTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) {
      return res.status(404).json({ error: "Limit template not found" });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertObjectSectionInScope(scope, tpl.warehouseId, tpl.section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    await prisma.objectLimitTemplate.delete({ where: { id: templateId } });
    return res.status(204).end();
  }
);

limitImportsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : undefined;
  if (warehouseId) {
    try {
      if (section) {
        assertObjectSectionInScope(scope, warehouseId, section);
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
  }
  const scopedWhere = objectLimitTemplateWhereFromScope(scope);
  const rows = await prisma.objectLimitTemplate.findMany({
    where: {
      ...(Object.keys(scopedWhere).length ? { AND: [scopedWhere] } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(section ? { section } : {})
    },
    include: {
      nodes: {
        orderBy: { orderNo: "asc" }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  return res.json(rows);
});
