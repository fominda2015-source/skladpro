export type CampItemCategory =
  | "CONTAINER_CABIN"
  | "FURNITURE"
  | "OFFICE_EQUIPMENT"
  | "APPLIANCES"
  | "OTHER";

export type CampCategoryNavId = "hub" | CampItemCategory;

export type CampCategoryDef = {
  id: CampCategoryNavId;
  label: string;
  icon: string;
  hint?: string;
};

export const CAMP_HUB_CARDS: CampCategoryDef[] = [
  { id: "CONTAINER_CABIN", label: "Бытовки/контейнеры", icon: "🏠", hint: "Вагончики, блок-контейнеры" },
  { id: "FURNITURE", label: "Мебель", icon: "🪑", hint: "Столы, стулья, шкафы" },
  { id: "OFFICE_EQUIPMENT", label: "Оргтехника", icon: "🖥️", hint: "ПК, принтеры, МФУ" },
  { id: "APPLIANCES", label: "Бытовая техника", icon: "🔌", hint: "Холодильники, кондиционеры" },
  { id: "OTHER", label: "Прочее", icon: "📦" }
];

export function campCategoryLabel(cat: CampItemCategory | string | null | undefined): string {
  return CAMP_HUB_CARDS.find((c) => c.id === cat)?.label ?? String(cat || "—");
}

export function campCategoryIcon(cat: CampItemCategory | string | null | undefined): string {
  return CAMP_HUB_CARDS.find((c) => c.id === cat)?.icon ?? "📦";
}

export function isCampCategoryNav(id: CampCategoryNavId): id is CampItemCategory {
  return id !== "hub";
}

export type CampSummary = {
  total: number;
  categories: Array<{ key: CampItemCategory; label: string; icon: string; count: number }>;
};
