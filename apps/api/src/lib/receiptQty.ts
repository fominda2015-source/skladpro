import { qtyFromDb } from "./quantity.js";

/** Плановое количество по позиции заявки (целое). */
export function receiptPlannedQty(value: unknown): number {
  return qtyFromDb(value);
}

/** Уже принято по позиции (целое, 0 если пусто). */
export function receiptAcceptedQty(value: unknown): number {
  return qtyFromDb(value);
}

/** Сколько ещё можно принять по позиции. */
export function receiptItemRemaining(item: { quantity: unknown; acceptedQty?: unknown | null }): number {
  const remaining = receiptPlannedQty(item.quantity) - receiptAcceptedQty(item.acceptedQty);
  return remaining > 0 ? remaining : 0;
}

export function isReceiptItemOpen(item: { quantity: unknown; acceptedQty?: unknown | null }): boolean {
  return receiptItemRemaining(item) > 0;
}

/** Все позиции приняты по округлённым количествам. */
export function isReceiptFullyAccepted(items: Array<{ quantity: unknown; acceptedQty?: unknown | null }>): boolean {
  return items.length === 0 || items.every((it) => !isReceiptItemOpen(it));
}

/** Принудительно закрывает все позиции: acceptedQty = план (целое). */
export function plannedQtyForItemClose(item: { quantity: unknown }): number {
  return receiptPlannedQty(item.quantity);
}

export function receiptCompletionStatus(
  row: { status: string; acceptedAt?: Date | null },
  items: Array<{ quantity: unknown; acceptedQty?: unknown | null }>
): { status: "RECEIVED" | "IN_PROGRESS" | "NEW" | "CANCELLED"; acceptedAt: Date | null } {
  if (row.status === "CANCELLED") {
    return { status: "CANCELLED", acceptedAt: row.acceptedAt ?? null };
  }
  const anyAccepted = items.some((it) => receiptAcceptedQty(it.acceptedQty) > 0);
  if (isReceiptFullyAccepted(items)) {
    return { status: "RECEIVED", acceptedAt: row.acceptedAt ?? new Date() };
  }
  if (anyAccepted || row.status === "IN_PROGRESS") {
    return { status: "IN_PROGRESS", acceptedAt: row.acceptedAt ?? null };
  }
  return { status: "NEW", acceptedAt: row.acceptedAt ?? null };
}
