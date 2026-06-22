import { Router } from "express";
import { z } from "zod";
import { assertObjectSectionInScope, getRequestDataScope } from "../lib/dataScope.js";
import { listStockLimitBindings } from "../lib/materialLimitBindings.js";
import { prisma } from "../lib/prisma.js";
import { materialQtyCoerceSchema } from "../lib/quantity.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  materialId: z.string().min(1),
  limitNodeId: z.string().min(1),
  quantity: materialQtyCoerceSchema.optional()
});

const patchSchema = z.object({
  quantity: materialQtyCoerceSchema
});

export const materialLimitBindingsRouter = Router();
materialLimitBindingsRouter.use(requireAuth);
materialLimitBindingsRouter.use(requirePermission("operations.read"));

materialLimitBindingsRouter.get("/", async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : null;
  const materialId = typeof req.query.materialId === "string" ? req.query.materialId.trim() : undefined;

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

  const rows = await listStockLimitBindings({ warehouseId, section, materialId });
  return res.json(rows);
});

/** MATERIAL-узлы лимита объекта для выбора при привязке. */
materialLimitBindingsRouter.get("/limit-nodes", async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : null;

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

  const templates = await prisma.objectLimitTemplate.findMany({
    where: { warehouseId, section },
    select: { id: true, title: true, section: true },
    orderBy: { createdAt: "desc" }
  });
  if (!templates.length) return res.json([]);

  const templateIds = templates.map((t) => t.id);
  const tplMeta = new Map(templates.map((t) => [t.id, t]));
  const nodes = await prisma.objectLimitNode.findMany({
    where: { templateId: { in: templateIds }, nodeType: "MATERIAL" },
    select: {
      id: true,
      templateId: true,
      title: true,
      materialName: true,
      unit: true,
      plannedQty: true,
      parentId: true,
      indexLabel: true
    },
    orderBy: [{ templateId: "asc" }, { orderNo: "asc" }]
  });

  const tree = await prisma.objectLimitNode.findMany({
    where: { templateId: { in: templateIds } },
    select: { id: true, templateId: true, parentId: true, title: true, indexLabel: true }
  });
  const treeByTpl = new Map<string, Map<string, { parentId: string | null; title: string; indexLabel: string | null }>>();
  for (const n of tree) {
    let m = treeByTpl.get(n.templateId);
    if (!m) {
      m = new Map();
      treeByTpl.set(n.templateId, m);
    }
    m.set(n.id, { parentId: n.parentId, title: n.title, indexLabel: n.indexLabel });
  }

  const payload = nodes.map((n) => {
    const m = treeByTpl.get(n.templateId);
    const parts: string[] = [];
    let cur: string | null = n.id;
    for (let g = 0; g < 64 && cur && m; g++) {
      const x = m.get(cur);
      if (!x) break;
      const label = [x.indexLabel, x.title].filter(Boolean).join(" ").trim();
      if (label) parts.unshift(label);
      cur = x.parentId;
    }
    const tpl = tplMeta.get(n.templateId);
    if (tpl?.title) parts.unshift(`${tpl.section === "SS" ? "СС" : "ЭОМ"} · ${tpl.title}`);
    return {
      id: n.id,
      templateId: n.templateId,
      templateTitle: tpl?.title ?? "",
      path: parts.join(" / "),
      title: n.title,
      materialName: n.materialName,
      unit: n.unit,
      plannedQty: n.plannedQty != null ? Number(n.plannedQty) : null
    };
  });

  return res.json(payload.sort((a, b) => a.path.localeCompare(b.path, "ru")));
});

materialLimitBindingsRouter.post("/", requirePermission("operations.write"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
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

  const node = await prisma.objectLimitNode.findUnique({
    where: { id: parsed.data.limitNodeId },
    include: { template: { select: { warehouseId: true, section: true, id: true } } }
  });
  if (!node || node.nodeType !== "MATERIAL") {
    return res.status(400).json({ error: "LIMIT_NODE_NOT_MATERIAL" });
  }
  if (
    node.template.warehouseId !== parsed.data.warehouseId ||
    node.template.section !== parsed.data.section
  ) {
    return res.status(400).json({ error: "LIMIT_NODE_WRONG_OBJECT" });
  }

  const material = await prisma.material.findUnique({
    where: { id: parsed.data.materialId },
    select: { id: true }
  });
  if (!material) return res.status(404).json({ error: "MATERIAL_NOT_FOUND" });

  const qty = parsed.data.quantity ?? 1;
  if (qty <= 0) return res.status(400).json({ error: "QUANTITY_POSITIVE" });

  const row = await prisma.stockMaterialLimitBinding.upsert({
    where: {
      warehouseId_section_materialId_limitNodeId: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        materialId: parsed.data.materialId,
        limitNodeId: parsed.data.limitNodeId
      }
    },
    create: {
      warehouseId: parsed.data.warehouseId,
      section: parsed.data.section,
      materialId: parsed.data.materialId,
      limitNodeId: parsed.data.limitNodeId,
      quantity: qty,
      createdById: req.user!.userId
    },
    update: { quantity: qty }
  });

  const [enriched] = await listStockLimitBindings({
    warehouseId: row.warehouseId,
    section: row.section,
    materialId: row.materialId
  });
  return res.status(201).json(enriched ?? row);
});

materialLimitBindingsRouter.patch("/:id", requirePermission("operations.write"), async (req: AuthedRequest, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!id) return res.status(400).json({ error: "BAD_ID" });

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  if (parsed.data.quantity <= 0) return res.status(400).json({ error: "QUANTITY_POSITIVE" });

  const existing = await prisma.stockMaterialLimitBinding.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

  const scope = await getRequestDataScope(req);
  try {
    assertObjectSectionInScope(scope, existing.warehouseId, existing.section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  await prisma.stockMaterialLimitBinding.update({
    where: { id },
    data: { quantity: parsed.data.quantity }
  });

  const rows = await listStockLimitBindings({
    warehouseId: existing.warehouseId,
    section: existing.section,
    materialId: existing.materialId
  });
  return res.json(rows);
});

materialLimitBindingsRouter.delete("/:id", requirePermission("operations.write"), async (req: AuthedRequest, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!id) return res.status(400).json({ error: "BAD_ID" });

  const existing = await prisma.stockMaterialLimitBinding.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

  const scope = await getRequestDataScope(req);
  try {
    assertObjectSectionInScope(scope, existing.warehouseId, existing.section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  await prisma.stockMaterialLimitBinding.delete({ where: { id } });
  return res.status(204).end();
});
