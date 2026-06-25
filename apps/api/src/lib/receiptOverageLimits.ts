import type { ObjectSection } from "@prisma/client";
import { analyzeCatalogNames } from "./parseOrderSheet.js";
import { syncReceiptItemToLimitTemplate } from "./receiptLimitSync.js";
import { appendBindingLimitPicks } from "./materialLimitBindings.js";
import { prisma } from "./prisma.js";

export type LimitNodePick = {
  id: string;
  templateId: string;
  section: ObjectSection;
  templateTitle: string;
  path: string;
  title: string;
  plannedQty: number | null;
  /** Коэффициент привязки склада (1 ед. склада → N в лимите) */
  coefficient?: number;
  bindingId?: string;
};

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const normalize = (s: string | null | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export async function findLimitNodesAcrossWarehouse(
  warehouseId: string,
  materialId: string,
  sourceName: string,
  currentTemplateId?: string | null
): Promise<{ current: LimitNodePick[]; otherSections: LimitNodePick[] }> {
  const templates = await prisma.objectLimitTemplate.findMany({
    where: { warehouseId },
    select: { id: true, section: true, title: true }
  });
  if (!templates.length) return { current: [], otherSections: [] };

  const templateIds = templates.map((t) => t.id);
  const templateMeta = new Map(templates.map((t) => [t.id, t]));

  const nodes = await prisma.objectLimitNode.findMany({
    where: { templateId: { in: templateIds }, nodeType: "MATERIAL" },
    select: {
      id: true,
      templateId: true,
      title: true,
      indexLabel: true,
      materialId: true,
      materialName: true,
      parentId: true,
      plannedQty: true
    }
  });

  const allTree = await prisma.objectLimitNode.findMany({
    where: { templateId: { in: templateIds } },
    select: { id: true, templateId: true, parentId: true, title: true, indexLabel: true }
  });

  type PathNode = { parentId: string | null; title: string; indexLabel: string | null };
  const treeByTemplate = new Map<string, Map<string, PathNode>>();
  for (const n of allTree) {
    let m = treeByTemplate.get(n.templateId);
    if (!m) {
      m = new Map();
      treeByTemplate.set(n.templateId, m);
    }
    m.set(n.id, { parentId: n.parentId, title: n.title, indexLabel: n.indexLabel });
  }

  function pathFor(templateId: string, nodeId: string): string {
    const m = treeByTemplate.get(templateId);
    if (!m) return "";
    const parts: string[] = [];
    let cur: string | null = nodeId;
    for (let guard = 0; guard < 64 && cur; guard += 1) {
      const node: PathNode | undefined = m.get(cur);
      if (!node) break;
      const label = [node.indexLabel, node.title].filter(Boolean).join(" ").trim();
      if (label) parts.unshift(label);
      cur = node.parentId;
    }
    const tpl = templateMeta.get(templateId);
    if (tpl?.title) parts.unshift(`${tpl.section === "SS" ? "СС" : "ЭОМ"} · ${tpl.title}`);
    return parts.join(" / ");
  }

  function matches(node: (typeof nodes)[number]): boolean {
    if (materialId && node.materialId === materialId) return true;
    if (!materialId && node.materialName && sourceName && normalize(node.materialName) === normalize(sourceName)) {
      return true;
    }
    return false;
  }

  const current: LimitNodePick[] = [];
  const otherSections: LimitNodePick[] = [];

  for (const n of nodes.filter(matches)) {
    const tpl = templateMeta.get(n.templateId);
    if (!tpl) continue;
    const pick: LimitNodePick = {
      id: n.id,
      templateId: n.templateId,
      section: tpl.section,
      templateTitle: tpl.title,
      path: pathFor(n.templateId, n.id),
      title: n.title,
      plannedQty: n.plannedQty != null ? Number(n.plannedQty) : null
    };
    if (currentTemplateId && n.templateId === currentTemplateId) {
      current.push(pick);
    } else {
      otherSections.push(pick);
    }
  }

  return { current, otherSections };
}

/** Узлы того же материала в других подразделах (для «размазать» излишек), без основного узла. */
export function spreadLimitNodePicks(
  picks: { current: LimitNodePick[]; otherSections: LimitNodePick[] },
  excludeNodeId?: string | null
): LimitNodePick[] {
  const all = [...picks.current, ...picks.otherSections];
  if (!excludeNodeId) return all;
  return all.filter((p) => p.id !== excludeNodeId);
}

/** Все узлы MATERIAL в лимитах объекта и раздела (СС/ЭОМ) — для выбора подраздела при выдаче */
export async function findLimitMaterialNodesInSection(
  warehouseId: string,
  section: ObjectSection,
  materialId: string,
  sourceName?: string | null
): Promise<LimitNodePick[]> {
  const templates = await prisma.objectLimitTemplate.findMany({
    where: { warehouseId, section },
    select: { id: true, section: true, title: true }
  });
  if (!templates.length) return [];

  const templateIds = templates.map((t) => t.id);
  const templateMeta = new Map(templates.map((t) => [t.id, t]));

  const nodes = await prisma.objectLimitNode.findMany({
    where: { templateId: { in: templateIds }, nodeType: "MATERIAL" },
    select: {
      id: true,
      templateId: true,
      title: true,
      indexLabel: true,
      materialId: true,
      materialName: true,
      parentId: true,
      plannedQty: true
    }
  });

  const allTree = await prisma.objectLimitNode.findMany({
    where: { templateId: { in: templateIds } },
    select: { id: true, templateId: true, parentId: true, title: true, indexLabel: true }
  });

  type PathNode = { parentId: string | null; title: string; indexLabel: string | null };
  const treeByTemplate = new Map<string, Map<string, PathNode>>();
  for (const n of allTree) {
    let m = treeByTemplate.get(n.templateId);
    if (!m) {
      m = new Map();
      treeByTemplate.set(n.templateId, m);
    }
    m.set(n.id, { parentId: n.parentId, title: n.title, indexLabel: n.indexLabel });
  }

  function pathFor(templateId: string, nodeId: string): string {
    const m = treeByTemplate.get(templateId);
    if (!m) return "";
    const parts: string[] = [];
    let cur: string | null = nodeId;
    for (let guard = 0; guard < 64 && cur; guard += 1) {
      const node: PathNode | undefined = m.get(cur);
      if (!node) break;
      const label = [node.indexLabel, node.title].filter(Boolean).join(" ").trim();
      if (label) parts.unshift(label);
      cur = node.parentId;
    }
    const tpl = templateMeta.get(templateId);
    if (tpl?.title) parts.unshift(`${tpl.section === "SS" ? "СС" : "ЭОМ"} · ${tpl.title}`);
    return parts.join(" / ");
  }

  const picks: LimitNodePick[] = [];
  for (const n of nodes) {
    const matchById = Boolean(materialId && n.materialId === materialId);
    const matchByName =
      !matchById &&
      Boolean(
        sourceName &&
          n.materialName &&
          normalize(n.materialName) === normalize(sourceName)
      );
    if (!matchById && !matchByName) continue;
    const tpl = templateMeta.get(n.templateId);
    if (!tpl) continue;
    picks.push({
      id: n.id,
      templateId: n.templateId,
      section: tpl.section,
      templateTitle: tpl.title,
      path: pathFor(n.templateId, n.id),
      title: n.title,
      plannedQty: n.plannedQty != null ? Number(n.plannedQty) : null
    });
  }

  return appendBindingLimitPicks(warehouseId, section, materialId, picks);
}

type ReceiptLimitItemRef = {
  sourceName: string;
  sourceUnit: string | null;
  limitSectionPath: string | null;
  limitCatalogNameN: string | null;
  limitCatalogNameO: string | null;
  limitNodeId: string | null;
  limitNameRenamed: boolean;
  namePartD: string | null;
  namePartE: string | null;
  externalComment: string | null;
};

/** materialId узла лимита (создаёт карточку по materialName узла, если в импорте не было id). */
export async function resolveMaterialIdForLimitNode(tx: Tx, limitNodeId: string): Promise<string | null> {
  const node = await tx.objectLimitNode.findUnique({
    where: { id: limitNodeId },
    select: { materialId: true, materialName: true, title: true, unit: true, nodeType: true }
  });
  if (!node || node.nodeType !== "MATERIAL") return null;
  if (node.materialId) return node.materialId;
  const name = String(node.materialName || node.title || "").trim();
  if (!name) return null;
  const unit = String(node.unit || "шт").trim() || "шт";
  const existing = await tx.material.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      unit: { equals: unit, mode: "insensitive" }
    },
    select: { id: true }
  });
  if (existing) return existing.id;
  const created = await tx.material.create({ data: { name, unit } });
  return created.id;
}

/** Синхронизирует materialId узла лимита с карточкой, по которой прошёл приход на склад. */
export async function attachMaterialToLimitNode(
  tx: Tx,
  limitNodeId: string,
  materialId: string
): Promise<void> {
  const node = await tx.objectLimitNode.findUnique({
    where: { id: limitNodeId },
    select: { nodeType: true, materialId: true }
  });
  if (!node || node.nodeType !== "MATERIAL" || node.materialId === materialId) return;
  await tx.objectLimitNode.update({
    where: { id: limitNodeId },
    data: { materialId }
  });
}

/** Подбор узла лимита при приёмке: явный выбор → уже привязанный → путь из заявки → создать строку в шаблоне. */
export async function resolveReceiptAcceptLimitNode(
  tx: Tx,
  templateId: string | null | undefined,
  item: ReceiptLimitItemRef,
  opts: {
    explicitLimitNodeId?: string | null;
    materialId: string | null;
    materialName: string;
    acceptedQty: number;
    warehouseId?: string;
    section?: ObjectSection;
  }
): Promise<string | null> {
  if (opts.explicitLimitNodeId) {
    if (opts.materialId) await attachMaterialToLimitNode(tx, opts.explicitLimitNodeId, opts.materialId);
    return opts.explicitLimitNodeId;
  }
  if (item.limitNodeId) {
    if (opts.materialId) await attachMaterialToLimitNode(tx, item.limitNodeId, opts.materialId);
    return item.limitNodeId;
  }
  if (opts.warehouseId && opts.section && opts.materialId) {
    const bindings = await tx.stockMaterialLimitBinding.findMany({
      where: {
        warehouseId: opts.warehouseId,
        section: opts.section,
        materialId: opts.materialId
      },
      orderBy: { createdAt: "asc" }
    });
    if (bindings.length === 1) {
      await attachMaterialToLimitNode(tx, bindings[0]!.limitNodeId, opts.materialId);
      return bindings[0]!.limitNodeId;
    }
  }
  if (!templateId || !opts.materialId) return null;

  const meta = analyzeCatalogNames(
    item.sourceName,
    item.namePartD || "",
    item.namePartE || "",
    item.limitCatalogNameN || "",
    item.limitCatalogNameO || "",
    item.externalComment || ""
  );

  const sync = await syncReceiptItemToLimitTemplate(tx, templateId, {
    limitSectionPath: item.limitSectionPath,
    namePartC: item.sourceName,
    limitCatalogNameN: item.limitCatalogNameN,
    limitCatalogNameO: item.limitCatalogNameO,
    // При приёмке переименовываем узел лимита, если факт заказа (C/D/E) не совпал с N.
    renameLimitToO: meta.renameLimitToO,
    limitDisplayName: meta.limitDisplayName,
    nameAlertNote: meta.nameAlertNote
  });
  if (sync.limitNodeId) {
    await attachMaterialToLimitNode(tx, sync.limitNodeId, opts.materialId);
    return sync.limitNodeId;
  }

  return ensureMaterialInCurrentLimitTemplate(
    tx,
    templateId,
    opts.materialId,
    opts.materialName,
    item.sourceUnit || "шт",
    opts.acceptedQty
  );
}

export async function ensureMaterialInCurrentLimitTemplate(
  tx: Tx,
  templateId: string,
  materialId: string,
  materialName: string,
  unit: string,
  extraQty: number
): Promise<string> {
  const existing = await tx.objectLimitNode.findFirst({
    where: { templateId, nodeType: "MATERIAL", materialId },
    select: { id: true, plannedQty: true }
  });
  if (existing) {
    const planned = Number(existing.plannedQty || 0);
    await tx.objectLimitNode.update({
      where: { id: existing.id },
      data: { plannedQty: planned + extraQty }
    });
    return existing.id;
  }

  const rootGroup =
    (await tx.objectLimitNode.findFirst({
      where: { templateId, nodeType: "GROUP", parentId: null },
      orderBy: { orderNo: "asc" }
    })) ||
    (await tx.objectLimitNode.create({
      data: {
        templateId,
        nodeType: "GROUP",
        title: "Приход сверх заявки",
        orderNo: 9999
      }
    }));

  const siblings = await tx.objectLimitNode.count({ where: { templateId, parentId: rootGroup.id } });
  const created = await tx.objectLimitNode.create({
    data: {
      templateId,
      parentId: rootGroup.id,
      nodeType: "MATERIAL",
      title: materialName,
      materialName,
      materialId,
      unit: unit || "шт",
      plannedQty: extraQty,
      orderNo: siblings
    }
  });
  return created.id;
}
