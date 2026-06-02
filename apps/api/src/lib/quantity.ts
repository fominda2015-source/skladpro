import { z } from "zod";

/** Количество материалов/расходников — только целые единицы. */
export function normalizeMaterialQty(value: unknown): number {
  if (value == null || value === "") return NaN;
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n);
}

export function toQtyNumber(value: unknown): number | null {
  const n = normalizeMaterialQty(value);
  return Number.isFinite(n) ? n : null;
}

/** Читает количество из БД/Decimal и округляет до целого. */
export function qtyFromDb(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export const materialQtySchema = z
  .number()
  .positive("Количество должно быть больше 0")
  .transform((n) => Math.round(n))
  .refine((n) => n > 0, "Количество должно быть больше 0");

export const materialQtyCoerceSchema = z.coerce
  .number()
  .positive("Количество должно быть больше 0")
  .max(1_000_000_000)
  .transform((n) => Math.round(n))
  .refine((n) => n > 0, "Количество должно быть больше 0");
