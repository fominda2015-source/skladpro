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

export type ReceiptItemCategory =
  | "EQUIPMENT"
  | "CONSUMABLE"
  | "CABLE"
  | "TOOL_MANUAL"
  | "TOOL_ELECTRIC_CORDLESS"
  | "TOOL_ELECTRIC_CORDED"
  | "PPE"
  | "TOOL_CONSUMABLE"
  | "KIP"
  | "TOWERS_LADDERS"
  | "CAMP_CONTAINER_CABIN"
  | "CAMP_FURNITURE"
  | "CAMP_OFFICE_EQUIPMENT"
  | "CAMP_APPLIANCES"
  | "CAMP_OTHER"
  | "OTHER";

export const RECEIPT_ITEM_CATEGORIES: ReceiptItemCategory[] = [
  "EQUIPMENT",
  "CONSUMABLE",
  "CABLE",
  "TOOL_MANUAL",
  "TOOL_ELECTRIC_CORDLESS",
  "TOOL_ELECTRIC_CORDED",
  "PPE",
  "TOOL_CONSUMABLE",
  "KIP",
  "TOWERS_LADDERS",
  "CAMP_CONTAINER_CABIN",
  "CAMP_FURNITURE",
  "CAMP_OFFICE_EQUIPMENT",
  "CAMP_APPLIANCES",
  "CAMP_OTHER",
  "OTHER"
];

export function receiptItemCategoryLabel(cat: ReceiptItemCategory | string | null | undefined) {
  return (
    {
      EQUIPMENT: "Оборудование",
      CONSUMABLE: "Расходники",
      CABLE: "Кабель",
      TOOL_MANUAL: "Инструмент · ручной",
      TOOL_ELECTRIC_CORDLESS: "Инструмент · электрический · аккумуляторный",
      TOOL_ELECTRIC_CORDED: "Инструмент · электрический · сетевой",
      PPE: "СИЗ",
      TOOL_CONSUMABLE: "Расходники для инструмента",
      KIP: "КИП",
      TOWERS_LADDERS: "Туры и стремянки",
      CAMP_CONTAINER_CABIN: "Городок · бытовки/контейнеры",
      CAMP_FURNITURE: "Городок · мебель",
      CAMP_OFFICE_EQUIPMENT: "Городок · оргтехника",
      CAMP_APPLIANCES: "Городок · бытовая техника",
      CAMP_OTHER: "Городок · прочее",
      OTHER: "Прочее"
    } as Record<string, string>
  )[String(cat || "")] ?? "—";
}
