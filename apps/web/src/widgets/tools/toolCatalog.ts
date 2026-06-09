export type ToolsNavId =
  | "hub"
  | "tool"
  | "tool-manual"
  | "tool-electric"
  | "tool-electric-cordless"
  | "tool-electric-corded"
  | "ppe"
  | "tool-consumable"
  | "kip"
  | "other";

export type ToolCatalogSummary = {
  toolManual: { count: number; inStock: number; issued: number; inRepair: number };
  toolElectric: { count: number; inStock: number; issued: number; inRepair: number };
  toolElectricCordless: { count: number; inStock: number; issued: number; inRepair: number };
  toolElectricCorded: { count: number; inStock: number; issued: number; inRepair: number };
  ppe: { count: number; qty: number };
  toolConsumable: { count: number; qty: number };
  kip: { count: number; qty: number };
  other: { count: number; qty: number };
};

export type ToolCountStats = {
  count: number;
  inStock: number;
  issued: number;
  inRepair: number;
};

export function mergeToolCountStats(...parts: ToolCountStats[]): ToolCountStats {
  return parts.reduce(
    (acc, p) => ({
      count: acc.count + p.count,
      inStock: acc.inStock + p.inStock,
      issued: acc.issued + p.issued,
      inRepair: acc.inRepair + p.inRepair
    }),
    { count: 0, inStock: 0, issued: 0, inRepair: 0 }
  );
}

export function buildToolsHubStats(summary: ToolCatalogSummary): Record<string, ToolCountStats | { count: number; qty: number }> {
  const toolAll = mergeToolCountStats(summary.toolManual, summary.toolElectric);
  return {
    tool: toolAll,
    "tool-manual": summary.toolManual,
    "tool-electric": summary.toolElectric,
    "tool-electric-cordless": summary.toolElectricCordless,
    "tool-electric-corded": summary.toolElectricCorded,
    ppe: summary.ppe,
    "tool-consumable": summary.toolConsumable,
    kip: summary.kip,
    other: summary.other
  };
}

export type ToolCatalogMaterialRow = {
  materialId: string;
  name: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  section: string;
  qtyNew: number;
  qtyUsed: number;
};

export const TOOL_CATEGORY_SLUGS = {
  MANUAL: "tool-manual",
  ELECTRIC: "tool-electric",
  ELECTRIC_CORDLESS: "tool-electric-cordless",
  ELECTRIC_CORDED: "tool-electric-corded",
  PPE: "tool-ppe",
  TOOL_CONSUMABLE: "tool-consumable",
  KIP: "tool-kip",
  OTHER: "tool-other"
} as const;

export const ALL_TOOL_CATEGORY_SLUGS = new Set<string>(Object.values(TOOL_CATEGORY_SLUGS));

export function isElectricToolCategorySlug(slug: string | null | undefined) {
  const s = String(slug || "").toLowerCase();
  return (
    s === TOOL_CATEGORY_SLUGS.ELECTRIC ||
    s === TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS ||
    s === TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED
  );
}

export type HubCardDef = {
  id: ToolsNavId;
  label: string;
  icon: string;
  hint?: string;
};

export const TOOLS_HUB_CARDS: HubCardDef[] = [
  { id: "tool", label: "Инструмент", icon: "🛠️", hint: "Ручной и электрический" },
  { id: "ppe", label: "СИЗ", icon: "🦺", hint: "Средства индивидуальной защиты" },
  { id: "tool-consumable", label: "Расходники для инструмента", icon: "📦", hint: "Пики, диски, оснастка" },
  { id: "kip", label: "КИП", icon: "📊", hint: "Контрольно-измерительные приборы" },
  { id: "other", label: "Прочее", icon: "📁" }
];

/** Разделы каталога для складских материалов (не учётных единиц Tool). */
export const CATALOG_MATERIAL_SECTIONS = [
  { value: "PPE" as const, label: "СИЗ" },
  { value: "TOOL_CONSUMABLE" as const, label: "Расходники" },
  { value: "KIP" as const, label: "КИП" },
  { value: "OTHER" as const, label: "Прочее" }
];

export type CatalogMaterialSection = (typeof CATALOG_MATERIAL_SECTIONS)[number]["value"];

export function catalogMaterialSectionLabel(section: string | null | undefined): string {
  const hit = CATALOG_MATERIAL_SECTIONS.find((s) => s.value === section);
  return hit?.label ?? section ?? "—";
}

export const TOOL_SUB_HUB_CARDS: HubCardDef[] = [
  { id: "tool-manual", label: "Ручной", icon: "🔧" },
  { id: "tool-electric", label: "Электрический", icon: "⚡" }
];

export const ELECTRIC_SUB_HUB_CARDS: HubCardDef[] = [
  { id: "tool-electric-cordless", label: "Аккумуляторный", icon: "🔋" },
  { id: "tool-electric-corded", label: "Сетевой", icon: "🔌" }
];

export function toolsNavTitle(path: ToolsNavId[]): string {
  const last = path[path.length - 1] ?? "hub";
  const all = [...TOOLS_HUB_CARDS, ...TOOL_SUB_HUB_CARDS, ...ELECTRIC_SUB_HUB_CARDS];
  return all.find((c) => c.id === last)?.label ?? "Инструменты/СИЗ";
}

export function navToCategorySlug(nav: ToolsNavId): string | null {
  if (nav === "tool-manual") return TOOL_CATEGORY_SLUGS.MANUAL;
  if (nav === "tool-electric") return TOOL_CATEGORY_SLUGS.ELECTRIC;
  if (nav === "tool-electric-cordless") return TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS;
  if (nav === "tool-electric-corded") return TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED;
  if (nav === "ppe") return TOOL_CATEGORY_SLUGS.PPE;
  if (nav === "tool-consumable") return TOOL_CATEGORY_SLUGS.TOOL_CONSUMABLE;
  if (nav === "kip") return TOOL_CATEGORY_SLUGS.KIP;
  if (nav === "other") return TOOL_CATEGORY_SLUGS.OTHER;
  return null;
}

/** Цепочка slug: сначала выбранная подкатегория, затем более широкие списки. */
export function navCategorySlugChain(nav: ToolsNavId): Array<string | null> {
  const primary = navToCategorySlug(nav);
  if (!primary) return [null];
  if (primary === TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS || primary === TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED) {
    return [primary, TOOL_CATEGORY_SLUGS.ELECTRIC, null];
  }
  if (primary === TOOL_CATEGORY_SLUGS.MANUAL || primary === TOOL_CATEGORY_SLUGS.ELECTRIC) {
    return [primary, null];
  }
  return [primary, null];
}

export function showToolsInventoryList(navPath: ToolsNavId[]): boolean {
  const current = navPath[navPath.length - 1] ?? "hub";
  if (current === "hub") return false;
  if (navToCategorySlug(current)) return true;
  return navPath.includes("tool");
}

export function navToMaterialSection(nav: ToolsNavId): string | null {
  if (nav === "ppe") return "PPE";
  if (nav === "tool-consumable") return "TOOL_CONSUMABLE";
  if (nav === "kip") return "KIP";
  if (nav === "other") return "OTHER";
  return null;
}

export function isMaterialNav(nav: ToolsNavId): boolean {
  return navToMaterialSection(nav) != null;
}

export function isToolListNav(nav: ToolsNavId): boolean {
  return navToCategorySlug(nav) != null;
}

export function usesToolNameGroupCards(nav: ToolsNavId): boolean {
  return nav === "other";
}

export function receiptCategoryToToolsNav(cat: string | null | undefined): ToolsNavId | null {
  const c = String(cat || "").toUpperCase();
  const map: Record<string, ToolsNavId> = {
    TOOL_MANUAL: "tool-manual",
    TOOL_ELECTRIC_CORDLESS: "tool-electric-cordless",
    TOOL_ELECTRIC_CORDED: "tool-electric-corded",
    PPE: "ppe",
    TOOL_CONSUMABLE: "tool-consumable",
    KIP: "kip",
    OTHER: "other"
  };
  return map[c] ?? null;
}

/** Полный путь навигации для прихода / главной. */
export function toolsNavPathFromSegment(segment: ToolsNavId): ToolsNavId[] {
  if (segment === "hub") return ["hub"];
  if (segment === "tool-manual") return ["hub", "tool", "tool-manual"];
  if (segment === "tool-electric-cordless" || segment === "tool-electric-corded") {
    return ["hub", "tool", "tool-electric", segment];
  }
  if (segment === "tool-electric") return ["hub", "tool", "tool-electric"];
  if (segment === "tool") return ["hub", "tool"];
  return ["hub", segment];
}
