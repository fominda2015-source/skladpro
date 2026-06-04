import { isElectricToolCategorySlug } from "./toolCatalog";

export const MANUAL_TOOL_CATEGORY = "Ручной";
export const ELECTRIC_TOOL_CATEGORY = "Электрический";
export const ELECTRIC_CORDLESS_CATEGORY = "Аккумуляторный";
export const ELECTRIC_CORDED_CATEGORY = "Сетевой";

const ELECTRIC_CATEGORY_NAMES = new Set([
  ELECTRIC_TOOL_CATEGORY.toLowerCase(),
  ELECTRIC_CORDLESS_CATEGORY.toLowerCase(),
  ELECTRIC_CORDED_CATEGORY.toLowerCase()
]);

const STORAGE_KEY = "skladpro:toolCreateDefaults";

export type ToolCreateDefaults = {
  categoryId: string;
  brand: string;
  toolType: string;
};

export function buildToolDisplayName(brand: string, toolType: string) {
  return [brand.trim(), toolType.trim()].filter(Boolean).join(" ");
}

export function loadToolCreateDefaults(): ToolCreateDefaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { categoryId: "", brand: "", toolType: "" };
    const parsed = JSON.parse(raw) as Partial<ToolCreateDefaults>;
    return {
      categoryId: typeof parsed.categoryId === "string" ? parsed.categoryId : "",
      brand: typeof parsed.brand === "string" ? parsed.brand : "",
      toolType: typeof parsed.toolType === "string" ? parsed.toolType : ""
    };
  } catch {
    return { categoryId: "", brand: "", toolType: "" };
  }
}

export function saveToolCreateDefaults(data: ToolCreateDefaults) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function isManualToolCategory(name?: string | null) {
  return String(name || "").trim().toLowerCase() === MANUAL_TOOL_CATEGORY.toLowerCase();
}

export function isElectricToolCategory(cat?: { name?: string | null; slug?: string | null } | null) {
  if (!cat) return false;
  if (isElectricToolCategorySlug(cat.slug)) return true;
  return ELECTRIC_CATEGORY_NAMES.has(String(cat.name || "").trim().toLowerCase());
}

export function isElectricToolCategoryId(
  categoryId: string,
  categories: Array<{ id: string; name: string; slug?: string | null }>
) {
  const cat = categories.find((c) => c.id === categoryId);
  return isElectricToolCategory(cat);
}

export function formatKitCompleteness(tool: { kitComplete?: boolean; kitMissingNote?: string | null }) {
  if (tool.kitComplete !== false) return "Комплект";
  const note = String(tool.kitMissingNote || "").trim();
  return note ? `Некомплект: ${note}` : "Некомплект";
}

export function pickDefaultCategories<T extends { id: string; name: string }>(categories: T[]) {
  const order = [MANUAL_TOOL_CATEGORY, ELECTRIC_TOOL_CATEGORY];
  return categories
    .filter((c) => order.some((n) => n.toLowerCase() === c.name.trim().toLowerCase()))
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}
