export type ReceiptRequestStatus = "NEW" | "IN_PROGRESS" | "RECEIVED" | "CANCELLED";

export function receiptStatusLabel(status: ReceiptRequestStatus | string) {
  return (
    {
      NEW: "Новая",
      IN_PROGRESS: "Частично принята",
      RECEIVED: "Принята полностью",
      CANCELLED: "Отменена"
    } as Record<string, string>
  )[status] ?? status;
}

export function receiptStatusTone(status: ReceiptRequestStatus | string): "ok" | "warn" | "bad" | "neutral" {
  if (status === "RECEIVED") return "ok";
  if (status === "CANCELLED") return "bad";
  if (status === "IN_PROGRESS") return "warn";
  return "neutral";
}

export type ReceiptItemCategory = "EQUIPMENT" | "CONSUMABLE" | "CABLE";

export const RECEIPT_ITEM_CATEGORIES: ReceiptItemCategory[] = ["EQUIPMENT", "CONSUMABLE", "CABLE"];

export function receiptItemCategoryLabel(cat: ReceiptItemCategory | string | null | undefined) {
  return (
    {
      EQUIPMENT: "Оборудование",
      CONSUMABLE: "Расходники",
      CABLE: "Кабель"
    } as Record<string, string>
  )[String(cat || "")] ?? "—";
}
