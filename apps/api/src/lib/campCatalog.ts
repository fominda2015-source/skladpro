import { CampItemCategory, ReceiptItemCategory } from "@prisma/client";

export type CampCategoryDef = {
  key: CampItemCategory;
  label: string;
  icon: string;
  receiptCategory: ReceiptItemCategory;
};

export const CAMP_CATEGORY_DEFS: CampCategoryDef[] = [
  {
    key: "CONTAINER_CABIN",
    label: "Бытовки/контейнеры",
    icon: "🏠",
    receiptCategory: "CAMP_CONTAINER_CABIN"
  },
  {
    key: "FURNITURE",
    label: "Мебель",
    icon: "🪑",
    receiptCategory: "CAMP_FURNITURE"
  },
  {
    key: "OFFICE_EQUIPMENT",
    label: "Оргтехника",
    icon: "🖥️",
    receiptCategory: "CAMP_OFFICE_EQUIPMENT"
  },
  {
    key: "APPLIANCES",
    label: "Бытовая техника",
    icon: "🔌",
    receiptCategory: "CAMP_APPLIANCES"
  },
  {
    key: "OTHER",
    label: "Прочее",
    icon: "📦",
    receiptCategory: "CAMP_OTHER"
  }
];

const receiptToCamp = new Map<ReceiptItemCategory, CampItemCategory>(
  CAMP_CATEGORY_DEFS.map((d) => [d.receiptCategory, d.key])
);

export function campCategoryLabel(cat: CampItemCategory | string | null | undefined): string {
  return CAMP_CATEGORY_DEFS.find((d) => d.key === cat)?.label ?? String(cat || "—");
}

export function campCategoryIcon(cat: CampItemCategory | string | null | undefined): string {
  return CAMP_CATEGORY_DEFS.find((d) => d.key === cat)?.icon ?? "📦";
}

export function receiptCategoryToCampCategory(
  cat: ReceiptItemCategory | null | undefined
): CampItemCategory | null {
  if (!cat) return null;
  return receiptToCamp.get(cat) ?? null;
}

export function isCampReceiptCategory(cat: ReceiptItemCategory | null | undefined): boolean {
  return receiptCategoryToCampCategory(cat) != null;
}
