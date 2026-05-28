export type LimitRiskNode = {
  id: string;
  parentId?: string | null;
  nodeType: "GROUP" | "MATERIAL";
  title: string;
  materialId?: string | null;
  materialName?: string | null;
  unit?: string | null;
  plannedQty?: string | number | null;
};

export type LimitRiskTemplate = {
  id: string;
  title: string;
  nodes: LimitRiskNode[];
};

export type LimitMaterialRiskRow = {
  nodeId: string;
  templateId: string;
  templateTitle: string;
  materialId: string | null;
  name: string;
  path: string;
  unit: string;
  planned: number;
  issued: number;
  arrived: number;
  percent: number;
  remaining: number;
  risk: "over" | "near" | "ok" | "empty";
};

export type LimitRiskStats = {
  total: number;
  over: number;
  near: number;
  ok: number;
  empty: number;
};

function nodePath(nodes: LimitRiskNode[], nodeId: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  let cur = byId.get(nodeId);
  while (cur?.parentId) {
    const parent = byId.get(cur.parentId);
    if (!parent || parent.nodeType !== "GROUP") break;
    parts.unshift(parent.title);
    cur = parent;
  }
  return parts.join(" → ");
}

export function buildLimitMaterialRows(
  templates: LimitRiskTemplate[],
  issuedTotalsByMaterialId: Map<string, number>,
  limitSupplyByMaterialId: Record<string, { arrivedQty?: number }>
): LimitMaterialRiskRow[] {
  const rows: LimitMaterialRiskRow[] = [];
  for (const tpl of templates) {
    for (const n of tpl.nodes) {
      if (n.nodeType !== "MATERIAL") continue;
      const planned = Number(n.plannedQty || 0);
      const issued = n.materialId ? Number(issuedTotalsByMaterialId.get(n.materialId) || 0) : 0;
      const arrived = n.materialId ? Number(limitSupplyByMaterialId[n.materialId]?.arrivedQty || 0) : 0;
      const percent = planned > 0 ? Math.round((issued / planned) * 100) : 0;
      const remaining = planned > 0 ? planned - issued : 0;
      let risk: LimitMaterialRiskRow["risk"] = "ok";
      if (planned <= 0) risk = "empty";
      else if (issued > planned) risk = "over";
      else if (percent >= 90) risk = "near";

      rows.push({
        nodeId: n.id,
        templateId: tpl.id,
        templateTitle: tpl.title,
        materialId: n.materialId ?? null,
        name: String(n.materialName || n.title || "—"),
        path: nodePath(tpl.nodes, n.id),
        unit: n.unit || "шт",
        planned,
        issued,
        arrived,
        percent,
        remaining,
        risk
      });
    }
  }
  return sortLimitRowsByRisk(rows);
}

export function sortLimitRowsByRisk(rows: LimitMaterialRiskRow[]): LimitMaterialRiskRow[] {
  const order = { over: 0, near: 1, ok: 2, empty: 3 };
  return [...rows].sort((a, b) => {
    const dr = order[a.risk] - order[b.risk];
    if (dr !== 0) return dr;
    return b.percent - a.percent;
  });
}

export function computeLimitRiskStats(rows: LimitMaterialRiskRow[]): LimitRiskStats {
  return rows.reduce(
    (acc, r) => {
      acc.total += 1;
      if (r.risk === "over") acc.over += 1;
      else if (r.risk === "near") acc.near += 1;
      else if (r.risk === "ok") acc.ok += 1;
      else acc.empty += 1;
      return acc;
    },
    { total: 0, over: 0, near: 0, ok: 0, empty: 0 }
  );
}
