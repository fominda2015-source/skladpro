import { limitTreeIndentPx } from "../limits/limitImportDiffUtils";
import { matchesSearchFields } from "../../shared/searchText";

export type ProductivityRow = {
  rowIndex: number;
  indexLabel?: string;
  workCode?: string;
  name: string;
  unit?: string;
  totalQty?: number | null;
  editable: boolean;
  nodeType: "GROUP" | "MATERIAL";
  level: number;
};

export type ProductivityTreeNode = {
  row: ProductivityRow;
  type: "GROUP" | "MATERIAL";
  children: ProductivityTreeNode[];
};

export function buildProductivityTree(rows: ProductivityRow[]): ProductivityTreeNode[] {
  const roots: ProductivityTreeNode[] = [];
  const stack: ProductivityTreeNode[] = [];

  for (const row of rows) {
    const type: ProductivityTreeNode["type"] =
      row.nodeType || (row.editable ? "MATERIAL" : "GROUP");
    const node: ProductivityTreeNode = {
      row: { ...row, nodeType: type, level: row.level ?? 0 },
      type,
      children: []
    };

    if (type === "GROUP") {
      const level = row.level ?? 0;
      while (stack.length > level) stack.pop();
      if (level === 0 || stack.length === 0) {
        roots.push(node);
      } else {
        stack[level - 1]!.children.push(node);
      }
      stack[level] = node;
      continue;
    }

    if (stack.length > 0) {
      stack[stack.length - 1]!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function countProductivityMaterials(node: ProductivityTreeNode): number {
  if (node.type === "MATERIAL") return 1;
  return node.children.reduce((sum, child) => sum + countProductivityMaterials(child), 0);
}

export function countAllProductivityMaterials(nodes: ProductivityTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + countProductivityMaterials(node), 0);
}

export function collapseProductivitySubtree(prev: Record<string, boolean>, nodeId: string, nodes: ProductivityTreeNode[]) {
  const byId = new Map<string, ProductivityTreeNode>();
  const walk = (list: ProductivityTreeNode[]) => {
    for (const n of list) {
      byId.set(String(n.row.rowIndex), n);
      walk(n.children);
    }
  };
  walk(nodes);

  const next = { ...prev };
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    next[cur] = false;
    const node = byId.get(cur);
    if (!node) continue;
    for (const child of node.children) {
      if (child.type === "GROUP") stack.push(String(child.row.rowIndex));
    }
  }
  return next;
}

export function filterProductivityTree(
  nodes: ProductivityTreeNode[],
  query: string
): { nodes: ProductivityTreeNode[]; expandIds: Set<string> } {
  const q = query.trim();
  if (!q) return { nodes, expandIds: new Set() };

  const walk = (node: ProductivityTreeNode): ProductivityTreeNode | null => {
    if (node.type === "MATERIAL") {
      return matchesSearchFields(q, node.row.name, node.row.workCode, node.row.indexLabel, node.row.unit) ? node : null;
    }
    const selfMatch = matchesSearchFields(q, node.row.name, node.row.workCode, node.row.indexLabel);
    if (selfMatch) return node;
    const children = node.children.map(walk).filter(Boolean) as ProductivityTreeNode[];
    if (!children.length) return null;
    return { ...node, children };
  };

  const filtered = nodes.map(walk).filter(Boolean) as ProductivityTreeNode[];
  const expandIds = new Set<string>();
  const collectExpand = (node: ProductivityTreeNode) => {
    if (node.type === "GROUP") {
      expandIds.add(String(node.row.rowIndex));
      node.children.forEach(collectExpand);
    }
  };
  filtered.forEach(collectExpand);
  return { nodes: filtered, expandIds };
}

export function productivityTreeIndentPx(depth: number): number {
  return limitTreeIndentPx(depth);
}
