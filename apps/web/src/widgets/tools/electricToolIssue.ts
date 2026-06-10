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
  materialId: string;
  name: string;
  unit: string;
  maxQty: number;
  qtyNew: number;
  qtyUsed: number;
  qty: string;
};

export type ElectricToolIssueWizardSubmit = {
  recipient: string;
  comment: string;
  photo: File | null;
  consumables: Array<{ materialId: string; quantity: number }>;
};
