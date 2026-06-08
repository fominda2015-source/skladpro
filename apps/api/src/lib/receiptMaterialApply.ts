import type { MaterialKind, Prisma, ReceiptItemCategory, ToolCatalogSection } from "@prisma/client";

export function parseReceiptStoragePlace(raw: string | null | undefined): {
  storageRoom: string | null;
  storageCell: string | null;
} {
  const s = String(raw ?? "").trim();
  if (!s) return { storageRoom: null, storageCell: null };
  const parts = s
    .split(/[,/|]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { storageRoom: parts[0]!, storageCell: parts.slice(1).join(" / ") };
  }
  return { storageRoom: s, storageCell: null };
}

export function receiptCategoryToMaterialKind(
  cat: ReceiptItemCategory | null | undefined
): MaterialKind | null {
  if (!cat) return null;
  if (cat === "CONSUMABLE" || cat === "TOOL_CONSUMABLE") return "CONSUMABLE";
  if (cat === "PPE") return "WORKWEAR";
  return "MATERIAL";
}

export function buildMaterialUpdatesFromReceiptItem(
  itemCategory: ReceiptItemCategory | null | undefined,
  toolSection: ToolCatalogSection | null,
  unitPrice: number | null | undefined
): Prisma.MaterialUpdateInput {
  const data: Prisma.MaterialUpdateInput = {};
  if (toolSection) data.toolCatalogSection = toolSection;
  const kind = receiptCategoryToMaterialKind(itemCategory);
  if (kind) data.kind = kind;
  if (unitPrice != null && Number.isFinite(unitPrice) && unitPrice >= 0) {
    data.unitPrice = unitPrice;
  }
  return data;
}
