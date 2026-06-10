export type WarehouseStockKindTab = "ALL" | "EQUIPMENT" | "CABLE" | "CONSUMABLE";
export type WarehouseReceiptCategory = "EQUIPMENT" | "CABLE" | "CONSUMABLE";

export const WAREHOUSE_RECEIPT_CATEGORY_OPTIONS: Array<{ value: WarehouseReceiptCategory; label: string }> = [
  { value: "EQUIPMENT", label: "Оборудование" },
  { value: "CABLE", label: "Кабель" },
  { value: "CONSUMABLE", label: "Расходники" }
];

export function warehouseStockKindTabLabel(tab: WarehouseStockKindTab): string {
  if (tab === "ALL") return "Все";
  const hit = WAREHOUSE_RECEIPT_CATEGORY_OPTIONS.find((o) => o.value === tab);
  return hit?.label ?? tab;
}

export function warehouseStockRowLabel(row: {
  materialKind?: string;
  materialCategory?: string | null;
}): string {
  if ((row.materialKind ?? "MATERIAL") === "CONSUMABLE") return "Расходники";
  const cat = String(row.materialCategory ?? "").toUpperCase();
  if (cat === "CABLE") return "Кабель";
  if (cat === "EQUIPMENT") return "Оборудование";
  if ((row.materialKind ?? "MATERIAL") === "WORKWEAR") return "Спецодежда";
  return "Оборудование";
}

export function warehouseStockRowMatchesTab(
  row: { materialKind?: string; materialCategory?: string | null },
  tab: WarehouseStockKindTab
): boolean {
  if (tab === "ALL") return true;
  if (tab === "CONSUMABLE") return (row.materialKind ?? "MATERIAL") === "CONSUMABLE";
  if ((row.materialKind ?? "MATERIAL") !== "MATERIAL") return false;
  const cat = String(row.materialCategory ?? "").toUpperCase();
  if (tab === "CABLE") return cat === "CABLE";
  return cat !== "CABLE";
}
