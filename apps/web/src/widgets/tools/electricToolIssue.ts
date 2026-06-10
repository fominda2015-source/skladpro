import { isElectricToolCategorySlug } from "./toolCatalog";

export type ElectricToolLike = {
  id: string;
  name?: string | null;
  category?: { slug?: string | null; name?: string | null } | null;
};

export function isElectricToolRecord(tool: ElectricToolLike | null | undefined): boolean {
  if (!tool) return false;
  if (isElectricToolCategorySlug(tool.category?.slug ?? null)) return true;
  return /электр|аккумулятор|сетев/i.test(String(tool.category?.name ?? ""));
}

export function filterElectricToolIds(tools: ElectricToolLike[], ids: string[]): string[] {
  const byId = new Map(tools.map((t) => [t.id, t]));
  return ids.filter((id) => isElectricToolRecord(byId.get(id)));
}

export type ConsumablePickLine = {
  key: string;
  materialId: string;
  name: string;
  unit: string;
  condition: "NEW" | "USED";
  maxQty: number;
  qty: string;
};

export type ElectricToolIssueWizardSubmit = {
  recipient: string;
  comment: string;
  photo: File | null;
  consumables: Array<{ materialId: string; quantity: number; condition: "NEW" | "USED" }>;
};

/** Сначала б/у, затем новые; внутри группы — по названию. */
export function sortConsumablePickLines<T extends { condition: "NEW" | "USED"; name: string }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    if (a.condition !== b.condition) return a.condition === "USED" ? -1 : 1;
    return a.name.localeCompare(b.name, "ru");
  });
}
