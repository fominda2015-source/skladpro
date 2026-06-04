/** Нормализация для сравнения наименований (УПД vs номенклатура карточки). */
export function normalizeMaterialNameKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Фактическое название = из УПД, отличается от номенклатуры карточки/лимита. */
export function isUpdFactName(factName: string, canonName: string): boolean {
  const f = normalizeMaterialNameKey(factName);
  const c = normalizeMaterialNameKey(canonName);
  return Boolean(f) && f !== c;
}

export type UpdFactEntry = {
  sourceName: string;
  sourceUnit: string;
  quantity: number;
};
