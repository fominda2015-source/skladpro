import type { ReceiptItemCategory, ToolCatalogSection } from "@prisma/client";
import { prisma } from "./prisma.js";

export const TOOL_CATEGORY_SLUGS = {
  MANUAL: "tool-manual",
  ELECTRIC: "tool-electric",
  ELECTRIC_CORDLESS: "tool-electric-cordless",
  ELECTRIC_CORDED: "tool-electric-corded"
} as const;

export const MANUAL_TOOL_CATEGORY = "Ручной";
export const ELECTRIC_TOOL_CATEGORY = "Электрический";
export const ELECTRIC_CORDLESS_CATEGORY = "Аккумуляторный";
export const ELECTRIC_CORDED_CATEGORY = "Сетевой";

export function isManualToolCategoryName(name: string | null | undefined) {
  return String(name || "").trim().toLowerCase() === MANUAL_TOOL_CATEGORY.toLowerCase();
}

export function isElectricToolCategorySlug(slug: string | null | undefined) {
  const s = String(slug || "").toLowerCase();
  return (
    s === TOOL_CATEGORY_SLUGS.ELECTRIC ||
    s === TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS ||
    s === TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED
  );
}

export function receiptCategoryToToolSection(
  cat: ReceiptItemCategory | null | undefined
): ToolCatalogSection | null {
  if (!cat) return null;
  const map: Partial<Record<ReceiptItemCategory, ToolCatalogSection>> = {
    TOOL_MANUAL: "TOOL_MANUAL",
    TOOL_ELECTRIC_CORDLESS: "TOOL_ELECTRIC_CORDLESS",
    TOOL_ELECTRIC_CORDED: "TOOL_ELECTRIC_CORDED",
    PPE: "PPE",
    TOOL_CONSUMABLE: "TOOL_CONSUMABLE",
    KIP: "KIP",
    OTHER: "OTHER"
  };
  return map[cat] ?? null;
}

export function toolSectionToCategorySlugs(section: ToolCatalogSection): string[] {
  switch (section) {
    case "TOOL_MANUAL":
      return [TOOL_CATEGORY_SLUGS.MANUAL];
    case "TOOL_ELECTRIC_CORDLESS":
      return [TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS];
    case "TOOL_ELECTRIC_CORDED":
      return [TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED];
    default:
      return [];
  }
}

export async function ensureDefaultToolCategories() {
  const rows: Array<{
    name: string;
    slug: string;
    icon: string;
    order: number;
    parentSlug?: string;
  }> = [
    { name: MANUAL_TOOL_CATEGORY, slug: TOOL_CATEGORY_SLUGS.MANUAL, icon: "🔧", order: 1 },
    { name: ELECTRIC_TOOL_CATEGORY, slug: TOOL_CATEGORY_SLUGS.ELECTRIC, icon: "⚡", order: 2 },
    {
      name: ELECTRIC_CORDLESS_CATEGORY,
      slug: TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS,
      icon: "🔋",
      order: 3,
      parentSlug: TOOL_CATEGORY_SLUGS.ELECTRIC
    },
    {
      name: ELECTRIC_CORDED_CATEGORY,
      slug: TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED,
      icon: "🔌",
      order: 4,
      parentSlug: TOOL_CATEGORY_SLUGS.ELECTRIC
    }
  ];
  const idBySlug = new Map<string, string>();
  for (const row of rows.filter((r) => !r.parentSlug)) {
    const cat = await prisma.toolCategory.upsert({
      where: { name: row.name },
      create: { name: row.name, slug: row.slug, icon: row.icon, order: row.order },
      update: { slug: row.slug, icon: row.icon, order: row.order, parentId: null }
    });
    idBySlug.set(row.slug, cat.id);
  }
  for (const row of rows.filter((r) => r.parentSlug)) {
    const parentId = idBySlug.get(row.parentSlug!) ?? null;
    const cat = await prisma.toolCategory.upsert({
      where: { name: row.name },
      create: {
        name: row.name,
        slug: row.slug,
        icon: row.icon,
        order: row.order,
        parentId
      },
      update: { slug: row.slug, icon: row.icon, order: row.order, parentId }
    });
    idBySlug.set(row.slug, cat.id);
  }
  return idBySlug;
}
