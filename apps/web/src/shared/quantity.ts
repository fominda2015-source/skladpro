/** Шаг и минимум для полей количества материалов/расходников. */
export const MATERIAL_QTY_STEP = 1;
export const MATERIAL_QTY_MIN = 1;

/** Парсит количество и округляет до целого (0 для пустого/невалидного). */
export function parseMaterialQty(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const n = Number(String(value).replace(",", ".").trim());
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** Форматирование количества без дробной части. */
export function formatMaterialQty(value: unknown): string {
  return parseMaterialQty(value).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

/** Нормализует ввод в поле: только целое ≥ 0. */
export function sanitizeMaterialQtyInput(raw: string): string {
  const trimmed = raw.replace(",", ".").trim();
  if (!trimmed) return "";
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return raw.replace(/[^\d]/g, "");
  return String(Math.round(n));
}
