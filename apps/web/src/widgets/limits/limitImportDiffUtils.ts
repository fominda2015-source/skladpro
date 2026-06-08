export const normLimitKey = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export type LimitDiffNode = {
  id: string;
  parentId?: string | null;
  nodeType: "GROUP" | "MATERIAL";
  title: string;
  materialName?: string | null;
  unit?: string | null;
  plannedQty?: string | number | null;
  issuedQty?: string | number | null;
  materialId?: string | null;
};

export type LimitMaterialDiffStatus = "new" | "qty_changed" | "unchanged";

export type LimitImportDiffView = {
  hasPrevious: boolean;
  added: number;
  removed: number;
  qtyChanged: number;
  removedItems: Array<{
    pathKey: string;
    label: string;
    unit: string | null;
    plannedQty: number | null;
    issuedQty: number;
  }>;
  qtyChangedItems: Array<{
    nodeId: string;
    label: string;
    unit: string | null;
    prevPlan: number | null;
    newPlan: number | null;
  }>;
  statusByNodeId: Map<string, LimitMaterialDiffStatus>;
  prevPlannedByNodeId: Map<string, number | null>;
};

function pathKeyForMaterialNode(node: LimitDiffNode, byId: Map<string, LimitDiffNode>): string {
  const parts: string[] = [];
  let cur: LimitDiffNode | undefined = node;
  const chain: LimitDiffNode[] = [];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
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

function indexMaterials(nodes: LimitDiffNode[]): Map<string, { plannedQty: number | null; nodeId: string }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, { plannedQty: number | null; nodeId: string }>();
  for (const n of nodes) {
    if (n.nodeType !== "MATERIAL") continue;
    const pathKey = pathKeyForMaterialNode(n, byId);
    out.set(pathKey, {
      plannedQty: n.plannedQty != null && n.plannedQty !== "" ? Number(n.plannedQty) : null,
      nodeId: n.id
    });
  }
  return out;
}

export function buildPathKeyByNodeId(nodes: LimitDiffNode[]): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string>();
  for (const n of nodes) {
    if (n.nodeType === "MATERIAL") {
      out.set(n.id, pathKeyForMaterialNode(n, byId));
    }
  }
  return out;
}

export function computeLimitImportDiffView(
  prevNodes: LimitDiffNode[],
  nextNodes: LimitDiffNode[]
): LimitImportDiffView {
  const prev = indexMaterials(prevNodes);
  const nextByPath = indexMaterials(nextNodes);
  const pathKeyByNodeId = buildPathKeyByNodeId(nextNodes);
  const statusByNodeId = new Map<string, LimitMaterialDiffStatus>();
  const prevPlannedByNodeId = new Map<string, number | null>();
  const removedItems: LimitImportDiffView["removedItems"] = [];
  const qtyChangedItems: LimitImportDiffView["qtyChangedItems"] = [];

  for (const [pathKey, p] of prev) {
    if (!nextByPath.has(pathKey)) {
      const node = prevNodes.find((x) => x.id === p.nodeId);
      removedItems.push({
        pathKey,
        label: pathKey.split("/").join(" → "),
        unit: node?.unit ?? null,
        plannedQty: p.plannedQty,
        issuedQty: node?.issuedQty != null ? Number(node.issuedQty) : 0
      });
    }
  }

  for (const n of nextNodes) {
    if (n.nodeType !== "MATERIAL") continue;
    const pathKey = pathKeyByNodeId.get(n.id) || "";
    const old = prev.get(pathKey);
    const newPlan = n.plannedQty != null && n.plannedQty !== "" ? Number(n.plannedQty) : null;
    if (!old) {
      statusByNodeId.set(n.id, "new");
      continue;
    }
    const oldPlan = old.plannedQty;
    const sameQty =
      (oldPlan == null && newPlan == null) ||
      (oldPlan != null && newPlan != null && Math.abs(oldPlan - newPlan) < 0.0005);
    if (sameQty) {
      statusByNodeId.set(n.id, "unchanged");
    } else {
      statusByNodeId.set(n.id, "qty_changed");
      prevPlannedByNodeId.set(n.id, oldPlan);
      qtyChangedItems.push({
        nodeId: n.id,
        label: pathKey.split("/").join(" → ") || String(n.materialName || n.title || ""),
        unit: n.unit ?? null,
        prevPlan: oldPlan,
        newPlan
      });
    }
  }

  const added = [...nextByPath.keys()].filter((k) => !prev.has(k)).length;

  return {
    hasPrevious: true,
    added,
    removed: removedItems.length,
    qtyChanged: [...statusByNodeId.values()].filter((s) => s === "qty_changed").length,
    removedItems,
    qtyChangedItems,
    statusByNodeId,
    prevPlannedByNodeId
  };
}

/** Отступ узла дерева: разделы и подразделы сильнее смещаются вправо. */
export function limitTreeIndentPx(depth: number): number {
  if (depth <= 0) return 0;
  return 12 + depth * 28;
}
