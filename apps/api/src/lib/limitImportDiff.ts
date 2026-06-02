import type { ObjectLimitNode } from "@prisma/client";

export const normLimitKey = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export type LimitMaterialIndexEntry = {
  pathKey: string;
  materialName: string;
  unit: string | null;
  plannedQty: number | null;
  issuedQty: number;
  materialId: string | null;
  nodeId: string;
};

type TreeNode = Pick<
  ObjectLimitNode,
  "id" | "parentId" | "nodeType" | "title" | "materialName" | "unit" | "plannedQty" | "issuedQty" | "materialId"
>;

/** Путь «раздел/подраздел/материал» для сопоставления между версиями лимита. */
export function pathKeyForMaterialNode(
  node: TreeNode,
  titleById: Map<string, TreeNode>
): string {
  const parts: string[] = [];
  let cur: TreeNode | undefined = node;
  const chain: TreeNode[] = [];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? titleById.get(cur.parentId) : undefined;
  }
  for (const n of chain) {
    if (n.nodeType === "GROUP") {
      parts.push(normLimitKey(n.title));
    } else if (n.id === node.id) {
      parts.push(normLimitKey(String(n.materialName || n.title || "")));
    }
  }
  return parts.join("/");
}

export function indexTemplateMaterials(nodes: TreeNode[]): Map<string, LimitMaterialIndexEntry> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, LimitMaterialIndexEntry>();
  for (const n of nodes) {
    if (n.nodeType !== "MATERIAL") continue;
    const pathKey = pathKeyForMaterialNode(n, byId);
    out.set(pathKey, {
      pathKey,
      materialName: String(n.materialName || n.title || ""),
      unit: n.unit,
      plannedQty: n.plannedQty != null ? Number(n.plannedQty) : null,
      issuedQty: Number(n.issuedQty || 0),
      materialId: n.materialId,
      nodeId: n.id
    });
  }
  return out;
}

/** Ключ материала при разборе плоского Excel (уровни GROUP в стеке). */
export function pathKeyFromFlatImport(
  groupTitlesByLevel: Map<number, string>,
  materialName: string,
  level: number
): string {
  const parts: string[] = [];
  for (let l = 0; l < level; l += 1) {
    const t = groupTitlesByLevel.get(l);
    if (t) parts.push(normLimitKey(t));
  }
  parts.push(normLimitKey(materialName));
  return parts.join("/");
}

export type LimitImportDiffSummary = {
  added: number;
  removed: number;
  qtyChanged: number;
  preservedIssuedLines: number;
  removedItems: Array<{
    pathKey: string;
    materialName: string;
    unit: string | null;
    plannedQty: number | null;
    issuedQty: number;
  }>;
  qtyChangedItems: Array<{
    pathKey: string;
    materialName: string;
    oldPlannedQty: number | null;
    newPlannedQty: number | null;
  }>;
};

export function computeLimitImportDiff(
  prevNodes: TreeNode[],
  nextNodes: TreeNode[]
): LimitImportDiffSummary {
  const prev = indexTemplateMaterials(prevNodes);
  const next = indexTemplateMaterials(nextNodes);
  const removedItems: LimitImportDiffSummary["removedItems"] = [];
  const qtyChangedItems: LimitImportDiffSummary["qtyChangedItems"] = [];
  let added = 0;

  for (const [key, p] of prev) {
    if (!next.has(key)) {
      removedItems.push({
        pathKey: key,
        materialName: p.materialName,
        unit: p.unit,
        plannedQty: p.plannedQty,
        issuedQty: p.issuedQty
      });
    }
  }

  for (const [key, n] of next) {
    const p = prev.get(key);
    if (!p) {
      added += 1;
      continue;
    }
    const oldPlan = p.plannedQty;
    const newPlan = n.plannedQty;
    const sameQty =
      (oldPlan == null && newPlan == null) ||
      (oldPlan != null && newPlan != null && Math.abs(oldPlan - newPlan) < 0.0005);
    if (!sameQty) {
      qtyChangedItems.push({
        pathKey: key,
        materialName: n.materialName,
        oldPlannedQty: oldPlan,
        newPlannedQty: newPlan
      });
    }
  }

  return {
    added,
    removed: removedItems.length,
    qtyChanged: qtyChangedItems.length,
    preservedIssuedLines: 0,
    removedItems,
    qtyChangedItems
  };
}

export function lookupIssuedQtyToPreserve(
  prevIndex: Map<string, LimitMaterialIndexEntry>,
  pathKey: string,
  materialId?: string | null
): number {
  const direct = prevIndex.get(pathKey);
  if (direct && direct.issuedQty > 0) return direct.issuedQty;
  if (!materialId) return 0;
  let best = 0;
  for (const e of prevIndex.values()) {
    if (e.materialId === materialId && e.issuedQty > best) best = e.issuedQty;
  }
  return best;
}
