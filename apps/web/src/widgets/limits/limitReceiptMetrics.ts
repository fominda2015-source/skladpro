import { parseMaterialQty } from "../../shared/quantity";

type ReceiptItemLike = {
  limitNodeId?: string | null;
  quantity: string | number;
  acceptedQty?: string | number | null;
};

type ReceiptLike = {
  warehouseId: string;
  section: "SS" | "EOM";
  status: string;
  items: ReceiptItemLike[];
};

type StockLike = {
  warehouseId: string;
  section: "SS" | "EOM";
  materialId: string;
  quantity: number | string;
};

type LimitMaterialNodeRef = {
  id: string;
  materialId: string | null;
};

function receiptMetricsFromRequests(
  receipts: ReceiptLike[],
  warehouseId: string,
  section: "SS" | "EOM"
): { arrivedByLimitNodeId: Record<string, number>; onOrderByLimitNodeId: Record<string, number> } {
  const arrivedByLimitNodeId: Record<string, number> = {};
  const onOrderByLimitNodeId: Record<string, number> = {};

  for (const r of receipts) {
    if (r.warehouseId !== warehouseId || r.section !== section) continue;
    if (r.status === "CANCELLED") continue;
    const open = r.status === "NEW" || r.status === "IN_PROGRESS";
    for (const it of r.items) {
      const nodeId = (it.limitNodeId || "").trim();
      if (!nodeId) continue;
      const accepted = parseMaterialQty(it.acceptedQty);
      if (accepted > 0) {
        arrivedByLimitNodeId[nodeId] = (arrivedByLimitNodeId[nodeId] || 0) + accepted;
      }
      if (open) {
        const planned = parseMaterialQty(it.quantity);
        const remaining = Math.max(0, planned - accepted);
        if (remaining > 0) {
          onOrderByLimitNodeId[nodeId] = (onOrderByLimitNodeId[nodeId] || 0) + remaining;
        }
      }
    }
  }

  return { arrivedByLimitNodeId, onOrderByLimitNodeId };
}

/** Узел, на который относим остаток склада (где уже есть приход по заявкам). */
export function pickStockAttributionNode(
  nodeIds: string[],
  arrivedByLimitNodeId: Record<string, number>
): string {
  let pick = nodeIds[0]!;
  let best = arrivedByLimitNodeId[pick] || 0;
  for (const id of nodeIds) {
    const v = arrivedByLimitNodeId[id] || 0;
    if (v > best) {
      best = v;
      pick = id;
    }
  }
  return pick;
}

/**
 * Приход в лимите: принято по заявкам на узел + остаток на складе (один раз на materialId,
 * на узел с наибольшим приходом по заявкам — без дублирования по всем подразделам).
 */
export function buildLimitReceiptMetricsFromReceipts(
  receipts: ReceiptLike[],
  stocks: StockLike[],
  limitMaterialNodes: LimitMaterialNodeRef[],
  warehouseId: string,
  section: "SS" | "EOM"
): { arrivedByLimitNodeId: Record<string, number>; onOrderByLimitNodeId: Record<string, number> } {
  const { arrivedByLimitNodeId, onOrderByLimitNodeId } = receiptMetricsFromRequests(
    receipts,
    warehouseId,
    section
  );

  const stockByMaterialId = new Map<string, number>();
  for (const s of stocks) {
    if (s.warehouseId !== warehouseId || s.section !== section) continue;
    const q = Number(s.quantity);
    if (!Number.isFinite(q) || q <= 0) continue;
    stockByMaterialId.set(s.materialId, (stockByMaterialId.get(s.materialId) || 0) + q);
  }

  const nodesByMaterialId = new Map<string, string[]>();
  for (const n of limitMaterialNodes) {
    const mid = (n.materialId || "").trim();
    if (!mid) continue;
    const arr = nodesByMaterialId.get(mid) || [];
    arr.push(n.id);
    nodesByMaterialId.set(mid, arr);
  }

  for (const [materialId, stockQty] of stockByMaterialId) {
    const nodeIds = nodesByMaterialId.get(materialId);
    if (!nodeIds?.length) continue;
    const targetId = pickStockAttributionNode(nodeIds, arrivedByLimitNodeId);
    arrivedByLimitNodeId[targetId] = Math.max(arrivedByLimitNodeId[targetId] || 0, stockQty);
  }

  return { arrivedByLimitNodeId, onOrderByLimitNodeId };
}

type SupplyMetricLike = { stockQty?: number; arrivedQty?: number };

/** Приход по строке лимита: заявки на узел + движения INCOME + остаток на складе. */
export function limitNodeArrivedQty(
  nodeId: string,
  materialId: string | null | undefined,
  arrivedByLimitNodeId: Record<string, number>,
  supply?: SupplyMetricLike | null
): number {
  const base = arrivedByLimitNodeId[nodeId] ?? 0;
  if (!materialId || !supply) return base;
  const stockQty = parseMaterialQty(supply.stockQty);
  const movementArrived = parseMaterialQty(supply.arrivedQty);
  return Math.max(base, movementArrived, stockQty);
}

/** Остаток/приход через явные привязки склада к строкам лимита. */
export function mergeBindingStockIntoArrivedMetrics(
  arrivedByLimitNodeId: Record<string, number>,
  bindings: Array<{ limitNodeId: string; materialId: string; quantity: number }>,
  supplyByMaterialId: Record<string, SupplyMetricLike>
): Record<string, number> {
  const next = { ...arrivedByLimitNodeId };
  for (const b of bindings) {
    const supply = supplyByMaterialId[b.materialId];
    if (!supply) continue;
    const stockQty = parseMaterialQty(supply.stockQty);
    const movementArrived = parseMaterialQty(supply.arrivedQty);
    const factor = b.quantity > 0 ? b.quantity : 1;
    const extra = Math.max(stockQty, movementArrived) * factor;
    if (extra <= 0) continue;
    next[b.limitNodeId] = (next[b.limitNodeId] || 0) + extra;
  }
  return next;
}

/** Остаток/приход из supply-metrics — один раз на materialId (для агрегатов групп). */
export function mergeSupplyStockIntoArrivedMetrics(
  arrivedByLimitNodeId: Record<string, number>,
  limitMaterialNodes: LimitMaterialNodeRef[],
  supplyByMaterialId: Record<string, SupplyMetricLike>
): Record<string, number> {
  const next = { ...arrivedByLimitNodeId };
  for (const [materialId, supply] of Object.entries(supplyByMaterialId)) {
    const stockQty = parseMaterialQty(supply.stockQty);
    const movementArrived = parseMaterialQty(supply.arrivedQty);
    const extra = Math.max(stockQty, movementArrived);
    if (extra <= 0) continue;
    const nodeIds = limitMaterialNodes.filter((n) => n.materialId === materialId).map((n) => n.id);
    if (!nodeIds.length) continue;
    const targetId = pickStockAttributionNode(nodeIds, next);
    next[targetId] = Math.max(next[targetId] || 0, extra);
  }
  return next;
}
