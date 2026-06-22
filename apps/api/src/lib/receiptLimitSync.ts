import type { Prisma } from "@prisma/client";
import { normNameKey } from "./parseOrderSheet.js";
import { prisma } from "./prisma.js";

type Tx = Prisma.TransactionClient;

export function parseLimitPathM(pathRaw: string): { root: string; subsection: string | null } {
  const s = String(pathRaw || "").replace(/\s+/g, " ").trim();
  if (!s.includes("#")) return { root: s, subsection: null };
  const [rootPart, ...rest] = s.split("#");
  return {
    root: rootPart.replace(/\s+/g, " ").trim(),
    subsection: rest.join("#").replace(/\s+/g, " ").trim() || null
  };
}

type TreeNode = {
  id: string;
  parentId: string | null;
  nodeType: string;
  title: string;
  materialName: string | null;
};

export function findMaterialNodeByLimitPath(
  nodes: TreeNode[],
  pathM: string,
  nameKeys: string[]
): TreeNode | null {
  const keys = nameKeys.map(normNameKey).filter(Boolean);
  if (!keys.length) return null;

  const { root, subsection } = parseLimitPathM(pathM);
  const rootKey = normNameKey(root);
  const subKey = subsection ? normNameKey(subsection) : "";

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = nodes.filter((n) => n.nodeType === "GROUP");

  let parentId: string | null = null;
  const rootGroup = groups.find((g) => !g.parentId && normNameKey(g.title) === rootKey);
  if (rootGroup) {
    parentId = rootGroup.id;
    if (subKey) {
      const sub = groups.find((g) => g.parentId === rootGroup.id && normNameKey(g.title) === subKey);
      if (sub) parentId = sub.id;
    }
  } else if (subKey) {
    const subAny = groups.find((g) => normNameKey(g.title) === subKey);
    if (subAny) parentId = subAny.id;
  }

  const materials = nodes.filter((n) => n.nodeType === "MATERIAL");
  const scoped = parentId ? materials.filter((m) => m.parentId === parentId) : materials;

  const matchNode = (m: TreeNode) => {
    const mn = normNameKey(m.materialName || m.title);
    return keys.some((k) => k === mn || (k.length > 8 && mn.includes(k)) || (mn.length > 8 && k.includes(mn)));
  };

  const inScope = scoped.find(matchNode);
  return inScope ?? null;
}

/** Раздел «товары вне бюджета» в шаблоне лимита (по названию группы). */
export function isOutOfBudgetGroupTitle(title: string | null | undefined): boolean {
  const k = normNameKey(String(title || ""));
  return (k.includes("вне") && k.includes("бюджет")) || (k.includes("товар") && k.includes("вне"));
}

function collectDescendantIds(rootId: string, nodes: Array<{ id: string; parentId: string | null }>): Set<string> {
  const out = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        changed = true;
      }
    }
  }
  return out;
}

function materialNameMatches(node: TreeNode, nameKeys: string[]): boolean {
  const mn = normNameKey(node.materialName || node.title);
  return nameKeys.some(
    (k) => k === mn || (k.length > 8 && mn.includes(k)) || (mn.length > 8 && k.includes(mn))
  );
}

/** Поиск материала в поддереве «товары вне бюджета» по наименованию. */
export function findOutOfBudgetMaterialNode(nodes: TreeNode[], nameKeys: string[]): TreeNode | null {
  const keys = nameKeys.map(normNameKey).filter(Boolean);
  if (!keys.length) return null;

  const groups = nodes.filter((n) => n.nodeType === "GROUP" && isOutOfBudgetGroupTitle(n.title));
  if (!groups.length) return null;

  const materials = nodes.filter((n) => n.nodeType === "MATERIAL");
  for (const group of groups) {
    const scopeIds = collectDescendantIds(group.id, nodes);
    const hit = materials.find((m) => m.parentId && scopeIds.has(m.parentId) && materialNameMatches(m, keys));
    if (hit) return hit;
  }
  return null;
}

export async function getActiveLimitTemplateId(
  tx: Tx,
  warehouseId: string,
  section: "SS" | "EOM"
): Promise<string | null> {
  const tpl = await tx.objectLimitTemplate.findFirst({
    where: { warehouseId, section },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  return tpl?.id ?? null;
}

export async function tryBindItemToOutOfBudgetSection(
  tx: Tx,
  templateId: string,
  item: ReceiptLimitSyncInput
): Promise<string | null> {
  const nodes = await tx.objectLimitNode.findMany({
    where: { templateId },
    select: {
      id: true,
      parentId: true,
      nodeType: true,
      title: true,
      materialName: true
    }
  });
  const searchNames = [
    item.namePartC,
    item.limitCatalogNameN || "",
    item.limitCatalogNameO || "",
    item.limitDisplayName
  ];
  const node = findOutOfBudgetMaterialNode(nodes, searchNames);
  return node?.id ?? null;
}

export type ReceiptLimitSyncInput = {
  limitSectionPath: string | null;
  namePartC: string;
  limitCatalogNameN: string | null;
  limitCatalogNameO: string | null;
  renameLimitToO: boolean;
  limitDisplayName: string;
  nameAlertNote: string | null;
};

export async function syncReceiptItemToLimitTemplate(
  tx: Tx,
  templateId: string,
  item: ReceiptLimitSyncInput
): Promise<{ limitNodeId: string | null; limitNameRenamed: boolean }> {
  if (!item.limitSectionPath?.trim()) {
    return { limitNodeId: null, limitNameRenamed: false };
  }

  const nodes = await tx.objectLimitNode.findMany({
    where: { templateId },
    select: {
      id: true,
      parentId: true,
      nodeType: true,
      title: true,
      materialName: true
    }
  });

  const searchNames = item.renameLimitToO
    ? [
        item.limitCatalogNameN || "",
        item.namePartC,
        item.limitCatalogNameO || "",
        item.limitDisplayName
      ]
    : [
        item.namePartC,
        item.limitCatalogNameN || "",
        item.limitCatalogNameO || "",
        item.limitDisplayName
      ];
  const node = findMaterialNodeByLimitPath(nodes, item.limitSectionPath, searchNames);
  if (!node) {
    return { limitNodeId: null, limitNameRenamed: false };
  }

  if (item.renameLimitToO && item.limitDisplayName) {
    await tx.objectLimitNode.update({
      where: { id: node.id },
      data: {
        materialName: item.limitDisplayName,
        title: item.limitDisplayName,
        nameAlertNote: item.nameAlertNote
      }
    });
    return { limitNodeId: node.id, limitNameRenamed: true };
  }

  if (item.nameAlertNote) {
    await tx.objectLimitNode.update({
      where: { id: node.id },
      data: { nameAlertNote: item.nameAlertNote }
    });
  }

  return { limitNodeId: node.id, limitNameRenamed: false };
}

export async function findReceiptInvoiceDoc(receiptId: string) {
  return prisma.documentFile.findFirst({
    where: {
      entityType: "receipt",
      entityId: receiptId,
      type: "receipt-invoice",
      isDeleted: false
    },
    orderBy: { createdAt: "desc" }
  });
}
