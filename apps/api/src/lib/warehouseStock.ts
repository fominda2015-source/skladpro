import { MaterialKind } from "@prisma/client";

export const WAREHOUSE_RECEIPT_CATEGORIES = ["EQUIPMENT", "CABLE", "CONSUMABLE"] as const;
export type WarehouseReceiptCategory = (typeof WAREHOUSE_RECEIPT_CATEGORIES)[number];

export function warehouseReceiptCategoryToMaterialFields(cat: WarehouseReceiptCategory): {
  kind: MaterialKind;
  category: string | null;
} {
  if (cat === "CONSUMABLE") return { kind: MaterialKind.CONSUMABLE, category: null };
  if (cat === "CABLE") return { kind: MaterialKind.MATERIAL, category: "CABLE" };
  return { kind: MaterialKind.MATERIAL, category: "EQUIPMENT" };
}
