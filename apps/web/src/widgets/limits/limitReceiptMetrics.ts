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

/** Приход и «в закупке» по узлу лимита (только принятые/открытые заявки с limitNodeId). */
export function buildLimitReceiptMetricsFromReceipts(
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
