/** Одноразовый расходник: выдаётся с инструментом и сразу списывается (без возврата). */
export function isDisposableToolConsumableName(name: string): boolean {
  const s = name.toLowerCase().replace(/ё/g, "е").trim();
  if (s.includes("гвозд")) return true;
  if (s.includes("газов") && s.includes("баллон")) return true;
  return false;
}

export const DISPOSABLE_TOOL_CONSUMABLE_HINT =
  "Одноразовый расходник — при выдаче с инструментом сразу списывается";
