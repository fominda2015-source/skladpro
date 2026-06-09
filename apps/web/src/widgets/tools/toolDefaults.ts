import { ALL_TOOL_CATEGORY_SLUGS, isElectricToolCategorySlug, TOOL_CATEGORY_SLUGS } from "./toolCatalog";

export const MANUAL_TOOL_CATEGORY = "Ручной";
export const ELECTRIC_TOOL_CATEGORY = "Электрический";
export const ELECTRIC_CORDLESS_CATEGORY = "Аккумуляторный";
export const ELECTRIC_CORDED_CATEGORY = "Сетевой";
export const PPE_TOOL_CATEGORY = "СИЗ";
export const TOOL_CONSUMABLE_CATEGORY = "Расходники для инструмента";
export const KIP_TOOL_CATEGORY = "КИП";
export const TOWERS_LADDERS_TOOL_CATEGORY = "Туры и стремянки";
export const OTHER_TOOL_CATEGORY = "Прочее";

/** Не категории — подписи статусов; такие строки в справочнике не показываем. */
const TOOL_STATUS_CATEGORY_NAMES = new Set([
  "на складе",
  "выдано",
  "в ремонте",
  "повреждён",
  "поврежден",
  "утерян",
  "списан",
  "спор"
]);

export type ToolCategoryLike = {
  id: string;
  name: string;
  icon?: string | null;
  slug?: string | null;
  order?: number;
  parentId?: string | null;
};

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

export function isMiscToolCategory(cat?: { name?: string | null; slug?: string | null } | null) {
  if (!cat) return false;
  const slug = String(cat.slug || "").toLowerCase();
  if (slug === TOOL_CATEGORY_SLUGS.OTHER || slug === TOOL_CATEGORY_SLUGS.TOWERS_LADDERS) return true;
  const name = String(cat.name || "").trim().toLowerCase();
  return (
    name === OTHER_TOOL_CATEGORY.toLowerCase() || name === TOWERS_LADDERS_TOOL_CATEGORY.toLowerCase()
  );
}

export function isMiscToolCategoryId(categoryId: string, categories: ToolCategoryLike[]) {
  const cat = categories.find((c) => c.id === categoryId);
  return isMiscToolCategory(cat);
}

export function toolCardRequiresBrandType(cat?: { name?: string | null; slug?: string | null } | null) {
  return !isMiscToolCategory(cat);
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

export function isKitTrackableToolCategory(cat?: { name?: string | null; slug?: string | null } | null) {
  if (!cat) return false;
  if (isElectricToolCategory(cat)) return true;
  const slug = String(cat.slug || "").toLowerCase();
  return slug === TOOL_CATEGORY_SLUGS.KIP || String(cat.name || "").trim().toLowerCase() === KIP_TOOL_CATEGORY.toLowerCase();
}

export function isKitTrackableToolCategoryId(categoryId: string, categories: ToolCategoryLike[]) {
  const cat = categories.find((c) => c.id === categoryId);
  return isKitTrackableToolCategory(cat);
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

export function isSelectableToolCategory(cat: ToolCategoryLike): boolean {
  const slug = String(cat.slug || "").trim();
  if (slug && ALL_TOOL_CATEGORY_SLUGS.has(slug)) return true;
  const name = String(cat.name || "").trim().toLowerCase();
  if (TOOL_STATUS_CATEGORY_NAMES.has(name)) return false;
  return false;
}

/** Все категории для редактирования карточки (дерево: родитель → дети). */
export function formatEditableToolCategoryOptions(
  categories: ToolCategoryLike[],
  currentCategoryId?: string | null
): Array<{ id: string; label: string }> {
  const selectable = categories.filter(isSelectableToolCategory);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sorted = [...selectable].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "ru")
  );
  const childrenByParent = new Map<string | null, ToolCategoryLike[]>();
  for (const c of sorted) {
    const pid = c.parentId ?? null;
    const list = childrenByParent.get(pid) || [];
    list.push(c);
    childrenByParent.set(pid, list);
  }
  const out: Array<{ id: string; label: string }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of childrenByParent.get(parentId) || []) {
      const indent = depth > 0 ? `${"  ".repeat(depth)}` : "";
      out.push({
        id: c.id,
        label: `${indent}${c.icon ? `${c.icon} ` : ""}${c.name}`
      });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const c of sorted) {
    if (out.some((o) => o.id === c.id)) continue;
    if (c.parentId && byId.has(c.parentId)) continue;
    out.push({ id: c.id, label: `${c.icon ? `${c.icon} ` : ""}${c.name}` });
  }
  if (currentCategoryId && !out.some((o) => o.id === currentCategoryId)) {
    const cur = byId.get(currentCategoryId);
    const stale = cur && !isSelectableToolCategory(cur);
    out.unshift({
      id: currentCategoryId,
      label: cur
        ? `${cur.icon ? `${cur.icon} ` : ""}${cur.name}${stale ? " (устар.)" : ""}`
        : currentCategoryId
    });
  }
  return out;
}
