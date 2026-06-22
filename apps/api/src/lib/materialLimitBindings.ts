import type { ObjectSection, Prisma } from "@prisma/client";
import type { LimitNodePick } from "./receiptOverageLimits.js";
import { prisma } from "./prisma.js";

type Tx = Prisma.TransactionClient;

export async function listStockLimitBindings(opts: {
  warehouseId: string;
  section: ObjectSection;
  materialId?: string;
}) {
  const rows = await prisma.stockMaterialLimitBinding.findMany({
    where: {
      warehouseId: opts.warehouseId,
      section: opts.section,
      ...(opts.materialId ? { materialId: opts.materialId } : {})
    },
    include: {
      material: { select: { id: true, name: true, unit: true } },
      limitNode: {
        select: {
          id: true,
          title: true,
          materialName: true,
          unit: true,
          plannedQty: true,
          templateId: true,
          nodeType: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const paths = await buildLimitNodePaths(rows.map((r) => r.limitNodeId));
  return rows.map((r) => ({
    id: r.id,
    warehouseId: r.warehouseId,
    section: r.section,
    materialId: r.materialId,
    materialName: r.material.name,
    materialUnit: r.material.unit,
    limitNodeId: r.limitNodeId,
    limitNodeTitle: r.limitNode.title,
    limitMaterialName: r.limitNode.materialName,
    limitUnit: r.limitNode.unit,
    plannedQty: r.limitNode.plannedQty != null ? Number(r.limitNode.plannedQty) : null,
    quantity: Number(r.quantity),
    path: paths.get(r.limitNodeId) ?? r.limitNode.title,
    createdAt: r.createdAt.toISOString()
  }));
}

export async function buildLimitNodePaths(nodeIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(nodeIds.filter(Boolean))];
  const result = new Map<string, string>();
  if (!unique.length) return result;

  const nodes = await prisma.objectLimitNode.findMany({
    where: { id: { in: unique } },
    select: { id: true, templateId: true, parentId: true, title: true, indexLabel: true }
  });
  const templateIds = [...new Set(nodes.map((n) => n.templateId))];
  const templates = await prisma.objectLimitTemplate.findMany({
    where: { id: { in: templateIds } },
    select: { id: true, section: true, title: true }
  });
  const tplMeta = new Map(templates.map((t) => [t.id, t]));

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

  for (const node of nodes) {
    const m = treeByTpl.get(node.templateId);
    const parts: string[] = [];
    let cur: string | null = node.id;
    for (let g = 0; g < 64 && cur && m; g++) {
      const x = m.get(cur);
      if (!x) break;
      const label = [x.indexLabel, x.title].filter(Boolean).join(" ").trim();
      if (label) parts.unshift(label);
      cur = x.parentId;
    }
    const tpl = tplMeta.get(node.templateId);
    if (tpl?.title) parts.unshift(`${tpl.section === "SS" ? "СС" : "ЭОМ"} · ${tpl.title}`);
    result.set(node.id, parts.join(" / "));
  }
  return result;
}

export async function appendBindingLimitPicks(
  warehouseId: string,
  section: ObjectSection,
  materialId: string,
  picks: LimitNodePick[]
): Promise<LimitNodePick[]> {
  if (!materialId.trim()) return picks;
  const bindings = await prisma.stockMaterialLimitBinding.findMany({
    where: { warehouseId, section, materialId },
    include: {
      limitNode: {
        select: {
          id: true,
          templateId: true,
          title: true,
          materialName: true,
          plannedQty: true,
          nodeType: true
        }
      }
    }
  });
  if (!bindings.length) return picks;

  const paths = await buildLimitNodePaths(bindings.map((b) => b.limitNodeId));
  const templateIds = [...new Set(bindings.map((b) => b.limitNode.templateId))];
  const templates = await prisma.objectLimitTemplate.findMany({
    where: { id: { in: templateIds } },
    select: { id: true, section: true, title: true }
  });
  const tplMeta = new Map(templates.map((t) => [t.id, t]));

  const seen = new Set(picks.map((p) => p.id));
  const merged = [...picks];
  for (const b of bindings) {
    const n = b.limitNode;
    if (n.nodeType !== "MATERIAL" || seen.has(n.id)) continue;
    seen.add(n.id);
    const tpl = tplMeta.get(n.templateId);
    merged.push({
      id: n.id,
      templateId: n.templateId,
      section: tpl?.section ?? section,
      templateTitle: tpl?.title ?? "",
      path: paths.get(n.id) ?? n.title,
      title: n.title,
      plannedQty: n.plannedQty != null ? Number(n.plannedQty) : null,
      coefficient: Number(b.quantity),
      bindingId: b.id
    });
  }
  return merged.sort((a, b) => a.path.localeCompare(b.path, "ru"));
}

export async function resolveLimitConsumptionQty(
  client: Tx | typeof prisma,
  warehouseId: string,
  section: ObjectSection,
  materialId: string,
  limitNodeId: string,
  stockQty: number
): Promise<number> {
  const binding = await client.stockMaterialLimitBinding.findUnique({
    where: {
      warehouseId_section_materialId_limitNodeId: {
        warehouseId,
        section,
        materialId,
        limitNodeId
      }
    },
    select: { quantity: true }
  });
  const factor = binding ? Number(binding.quantity) : 1;
  if (!Number.isFinite(factor) || factor <= 0) return stockQty;
  return stockQty * factor;
}

export async function ensureStockLimitBinding(
  tx: Tx,
  opts: {
    warehouseId: string;
    section: ObjectSection;
    materialId: string;
    limitNodeId: string;
    userId?: string | null;
  }
): Promise<void> {
  await tx.stockMaterialLimitBinding.upsert({
    where: {
      warehouseId_section_materialId_limitNodeId: {
        warehouseId: opts.warehouseId,
        section: opts.section,
        materialId: opts.materialId,
        limitNodeId: opts.limitNodeId
      }
    },
    create: {
      warehouseId: opts.warehouseId,
      section: opts.section,
      materialId: opts.materialId,
      limitNodeId: opts.limitNodeId,
      quantity: 1,
      createdById: opts.userId ?? null
    },
    update: {}
  });
}

export async function resolveDefaultLimitNodeId(
  warehouseId: string,
  section: ObjectSection,
  materialId: string
): Promise<string | null> {
  const bindings = await prisma.stockMaterialLimitBinding.findMany({
    where: { warehouseId, section, materialId },
    select: { limitNodeId: true },
    orderBy: { createdAt: "asc" }
  });
  if (bindings.length === 1) return bindings[0]!.limitNodeId;
  return null;
}
