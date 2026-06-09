import type { ReceiptItemCategory, ToolCatalogSection } from "@prisma/client";
import { prisma } from "./prisma.js";

export const TOOL_CATEGORY_SLUGS = {
  MANUAL: "tool-manual",
  ELECTRIC: "tool-electric",
  ELECTRIC_CORDLESS: "tool-electric-cordless",
  ELECTRIC_CORDED: "tool-electric-corded",
  PPE: "tool-ppe",
  TOOL_CONSUMABLE: "tool-consumable",
  KIP: "tool-kip",
  TOWERS_LADDERS: "tool-towers-ladders",
  OTHER: "tool-other"
} as const;

export const MANUAL_TOOL_CATEGORY = "Ручной";
export const ELECTRIC_TOOL_CATEGORY = "Электрический";
export const ELECTRIC_CORDLESS_CATEGORY = "Аккумуляторный";
export const ELECTRIC_CORDED_CATEGORY = "Сетевой";
export const PPE_TOOL_CATEGORY = "СИЗ";
export const TOOL_CONSUMABLE_CATEGORY = "Расходники для инструмента";
export const KIP_TOOL_CATEGORY = "КИП";
export const TOWERS_LADDERS_TOOL_CATEGORY = "Туры и стремянки";
export const OTHER_TOOL_CATEGORY = "Прочее";

export const ALL_TOOL_CATEGORY_SLUGS = new Set<string>(Object.values(TOOL_CATEGORY_SLUGS));

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

const ELECTRIC_CATEGORY_NAMES = new Set([
  ELECTRIC_TOOL_CATEGORY.toLowerCase(),
  ELECTRIC_CORDLESS_CATEGORY.toLowerCase(),
  ELECTRIC_CORDED_CATEGORY.toLowerCase()
]);

export function isElectricToolCategoryName(name: string | null | undefined) {
  return ELECTRIC_CATEGORY_NAMES.has(String(name || "").trim().toLowerCase());
}

export async function isElectricToolCategoryId(categoryId: string | null | undefined) {
  if (!categoryId) return false;
  const cat = await prisma.toolCategory.findUnique({
    where: { id: categoryId },
    include: { parent: true }
  });
  if (!cat) return false;
  if (isElectricToolCategorySlug(cat.slug)) return true;
  if (cat.parent && isElectricToolCategorySlug(cat.parent.slug)) return true;
  if (isElectricToolCategoryName(cat.name)) return true;
  return cat.parent ? isElectricToolCategoryName(cat.parent.name) : false;
}

export function isKitTrackableCategorySlug(slug: string | null | undefined): boolean {
  return isElectricToolCategorySlug(slug) || String(slug || "").toLowerCase() === TOOL_CATEGORY_SLUGS.KIP;
}

export function isKitTrackableCategoryName(name: string | null | undefined): boolean {
  const n = String(name || "").trim().toLowerCase();
  return isElectricToolCategoryName(name) || n === KIP_TOOL_CATEGORY.toLowerCase();
}

export async function isKitTrackableCategoryId(categoryId: string | null | undefined): Promise<boolean> {
  if (!categoryId) return false;
  const cat = await prisma.toolCategory.findUnique({
    where: { id: categoryId },
    include: { parent: true }
  });
  if (!cat) return false;
  if (isKitTrackableCategorySlug(cat.slug)) return true;
  if (cat.parent && isKitTrackableCategorySlug(cat.parent.slug)) return true;
  if (isKitTrackableCategoryName(cat.name)) return true;
  return cat.parent ? isKitTrackableCategoryName(cat.parent.name) : false;
}

export function normalizeToolKitFields(
  kitTrackable: boolean,
  kitComplete?: boolean,
  kitMissingNote?: string | null
): { kitComplete: boolean; kitMissingNote: string | null } | { error: string } {
  if (!kitTrackable) {
    return { kitComplete: true, kitMissingNote: null };
  }
  const complete = kitComplete !== false;
  const note = String(kitMissingNote || "").trim();
  if (complete) {
    return { kitComplete: true, kitMissingNote: null };
  }
  if (!note) {
    return { error: "Укажите, чего не хватает в комплекте" };
  }
  return { kitComplete: false, kitMissingNote: note };
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
    TOWERS_LADDERS: "TOWERS_LADDERS",
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
    case "PPE":
      return [TOOL_CATEGORY_SLUGS.PPE];
    case "TOOL_CONSUMABLE":
      return [TOOL_CATEGORY_SLUGS.TOOL_CONSUMABLE];
    case "KIP":
      return [TOOL_CATEGORY_SLUGS.KIP];
    case "TOWERS_LADDERS":
      return [TOOL_CATEGORY_SLUGS.TOWERS_LADDERS];
    case "OTHER":
      return [TOOL_CATEGORY_SLUGS.OTHER];
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
    },
    { name: PPE_TOOL_CATEGORY, slug: TOOL_CATEGORY_SLUGS.PPE, icon: "🦺", order: 5 },
    {
      name: TOOL_CONSUMABLE_CATEGORY,
      slug: TOOL_CATEGORY_SLUGS.TOOL_CONSUMABLE,
      icon: "📦",
      order: 6
    },
    { name: KIP_TOOL_CATEGORY, slug: TOOL_CATEGORY_SLUGS.KIP, icon: "📊", order: 7 },
    {
      name: TOWERS_LADDERS_TOOL_CATEGORY,
      slug: TOOL_CATEGORY_SLUGS.TOWERS_LADDERS,
      icon: "🪜",
      order: 8
    },
    { name: OTHER_TOOL_CATEGORY, slug: TOOL_CATEGORY_SLUGS.OTHER, icon: "📁", order: 9 }
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
