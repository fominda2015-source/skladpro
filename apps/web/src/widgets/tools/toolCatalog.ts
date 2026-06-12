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
  | "towers-ladders"
  | "other";

export type ToolCatalogSummary = {
  toolManual: { count: number; inStock: number; issued: number; inRepair: number };
  toolElectric: { count: number; inStock: number; issued: number; inRepair: number };
  toolElectricCordless: { count: number; inStock: number; issued: number; inRepair: number };
  toolElectricCorded: { count: number; inStock: number; issued: number; inRepair: number };
  ppe: ToolCountStats;
  toolConsumable: { count: number; qty: number };
  kip: ToolCountStats;
  towersLadders: ToolCountStats;
  other: ToolCountStats;
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
    "towers-ladders": summary.towersLadders,
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
  lineTotal?: number | null;
  priceBasisQty?: number | null;
  stockAmount?: number | null;
};

/** Строка расходника в каталоге (отдельно новые и б/у). */
export type ToolCatalogConsumableLine = {
  key: string;
  stockId: string;
  materialId: string;
  name: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  section: string;
  condition: "NEW" | "USED";
  quantity: number;
  disputed?: boolean;
  note?: string | null;
  cardStatus?: "IN_STOCK" | "DISPUTED" | "WRITTEN_OFF";
};

export type ToolCatalogConsumableEvent = {
  id: string;
  action: string;
  comment?: string | null;
  createdAt: string;
};

export type ToolCatalogConsumableDetail = ToolCatalogConsumableLine & {
  reserved?: number;
  events: ToolCatalogConsumableEvent[];
};

export function consumableConditionLabel(condition: "NEW" | "USED"): string {
  return condition === "USED" ? "Б/у (старые)" : "Новые";
}

export function consumableCardStatusLabel(status: string | undefined): string {
  if (status === "DISPUTED") return "Спор";
  if (status === "WRITTEN_OFF") return "Списано";
  return "На складе";
}

export function consumableActionLabel(action: string): string {
  const map: Record<string, string> = {
    CREATE: "Создание",
    EDIT: "Редактирование",
    QTY_ADJUST: "Корректировка кол-ва",
    ISSUE: "Выдача",
    WRITE_OFF: "Списание",
    DISPUTE: "Спор",
    CLEAR_DISPUTE: "Снят спор",
    DELETE: "Удаление"
  };
  return map[action] ?? action;
}

export function isConsumableCatalogNav(nav: ToolsNavId): boolean {
  return nav === "tool-consumable";
}

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
  { id: "ppe", label: "СИЗ", icon: "🦺", hint: "Учётные единицы с инв. № и QR" },
  { id: "tool-consumable", label: "Расходники для инструмента", icon: "📦", hint: "Карточки с количеством на объекте" },
  { id: "kip", label: "КИП", icon: "📊", hint: "Учётные единицы с инв. № и QR" },
  { id: "towers-ladders", label: "Туры и стремянки", icon: "🪜", hint: "Учётные единицы с инв. № и QR" },
  { id: "other", label: "Прочее", icon: "📁", hint: "Учётные единицы с инв. № и QR" }
];

/** Разделы каталога для складских материалов (кол-во на объекте). СИЗ, КИП, туры и прочее — учётные единицы Tool. */
export const CATALOG_MATERIAL_SECTIONS = [
  { value: "TOOL_CONSUMABLE" as const, label: "Расходники для инструмента" }
];

export type CatalogMaterialSection = (typeof CATALOG_MATERIAL_SECTIONS)[number]["value"];

/** Устаревшие разделы материалов (остатки до перехода на учётные единицы). */
export type LegacyCatalogMaterialSection = "KIP" | "TOWERS_LADDERS" | "OTHER";

export type ApiCatalogMaterialSection = CatalogMaterialSection | LegacyCatalogMaterialSection;

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
  if (nav === "towers-ladders") return TOOL_CATEGORY_SLUGS.TOWERS_LADDERS;
  if (nav === "other") return TOOL_CATEGORY_SLUGS.OTHER;
  return null;
}

/** Цепочка slug: сначала выбранная подкатегория, затем более широкие списки. */
export function navCategorySlugChain(nav: ToolsNavId): Array<string | null> {
  const primary = navToCategorySlug(nav);
  if (!primary) return [null];
  return [primary];
}

/** Промежуточные уровни навигации — без списков учётных единиц. */
export function isToolsCatalogIntermediateNav(nav: ToolsNavId): boolean {
  return nav === "hub" || nav === "tool" || nav === "tool-electric";
}

/** Конечная категория каталога (не хаб и не подменю «Инструмент» / «Электрический»). */
export function isToolsCatalogLeafNav(nav: ToolsNavId): boolean {
  if (isToolsCatalogIntermediateNav(nav)) return false;
  if (isConsumableCatalogNav(nav)) return false;
  return navToCategorySlug(nav) != null;
}

/** Список учётных единиц: только на конечной категории; для групп — после выбора строки. */
export function showToolsInventoryList(navPath: ToolsNavId[], hasGroupFilter = false): boolean {
  const current = navPath[navPath.length - 1] ?? "hub";
  if (!isToolsCatalogLeafNav(current)) return false;
  if (isPureMaterialCatalogNav(current)) return false;
  if (usesToolNameGroupCards(current)) return hasGroupFilter;
  const slug = navToCategorySlug(current);
  return (
    slug === TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS || slug === TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED
  );
}

export function shouldLoadToolsInventoryList(navPath: ToolsNavId[], hasGroupFilter: boolean): boolean {
  return showToolsInventoryList(navPath, hasGroupFilter);
}

export function navToMaterialSection(nav: ToolsNavId): string | null {
  if (nav === "tool-consumable") return "TOOL_CONSUMABLE";
  return null;
}

/** Старые остатки, ошибочно заведённые как материалы (до перехода на учётные единицы). */
export function legacyMaterialCatalogSection(nav: ToolsNavId): LegacyCatalogMaterialSection | null {
  if (nav === "kip") return "KIP";
  if (nav === "towers-ladders") return "TOWERS_LADDERS";
  if (nav === "other") return "OTHER";
  return null;
}

export function isMaterialNav(nav: ToolsNavId): boolean {
  return navToMaterialSection(nav) != null && !isConsumableCatalogNav(nav);
}

/** @deprecated только расходники — материальный каталог; КИП переведён на учётные единицы */
export function isPureMaterialCatalogNav(_nav: ToolsNavId): boolean {
  return false;
}

const CATALOG_MATERIAL_SLUGS = new Set<string>([TOOL_CATEGORY_SLUGS.TOOL_CONSUMABLE]);

export function isCatalogMaterialCategorySlug(slug: string | null | undefined): boolean {
  return CATALOG_MATERIAL_SLUGS.has(String(slug || "").toLowerCase());
}

export function slugToCatalogMaterialSection(slug: string | null | undefined): ApiCatalogMaterialSection | null {
  const s = String(slug || "").toLowerCase();
  if (s === TOOL_CATEGORY_SLUGS.TOOL_CONSUMABLE) return "TOOL_CONSUMABLE";
  if (s === TOOL_CATEGORY_SLUGS.KIP) return "KIP";
  if (s === TOOL_CATEGORY_SLUGS.TOWERS_LADDERS) return "TOWERS_LADDERS";
  if (s === TOOL_CATEGORY_SLUGS.OTHER) return "OTHER";
  return null;
}

export function isToolListNav(nav: ToolsNavId): boolean {
  return navToCategorySlug(nav) != null;
}

/** Группировка одинаковых названий — во всех категориях, кроме аккумуляторного и сетевого инструмента. */
export function usesToolNameGroupCards(nav: ToolsNavId): boolean {
  const slug = navToCategorySlug(nav);
  if (!slug) return false;
  return slug !== TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS && slug !== TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED;
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
    TOWERS_LADDERS: "towers-ladders",
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
