import { qtyFromDb } from "./quantity.js";

/** Плановое количество по позиции заявки (целое). */
export function receiptPlannedQty(value: unknown): number {
  return qtyFromDb(value);
}

/** Уже принято по позиции (целое, 0 если пусто). */
export function receiptAcceptedQty(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
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
  return items.every((it) => !isReceiptItemOpen(it));
}
