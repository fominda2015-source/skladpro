/** Сумма за `basisQty` единиц (из прихода или карточки). */
export type MaterialPriceBasis = {
  lineTotal: number;
  basisQty: number;
};

export function unitCostFromBasis(basis: MaterialPriceBasis): number {
  if (basis.basisQty > 0) return basis.lineTotal / basis.basisQty;
  return basis.lineTotal;
}

export function amountForQuantity(basis: MaterialPriceBasis, qty: number): number {
  if (qty <= 0) return 0;
  return unitCostFromBasis(basis) * qty;
}

export function formatMoney(value: number): string {
  return value.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatMoneyOrDash(value?: number | null): string {
  return value != null && Number.isFinite(value) ? `${formatMoney(value)} ₽` : "—";
}

export function basisFromStockRow(row: {
  lineTotal?: number | null;
  priceBasisQty?: number | null;
  unitPrice?: number | null;
}): MaterialPriceBasis | null {
  const lineTotal =
    row.lineTotal != null && Number.isFinite(Number(row.lineTotal))
      ? Number(row.lineTotal)
      : row.unitPrice != null && Number.isFinite(Number(row.unitPrice))
        ? Number(row.unitPrice)
        : null;
  if (lineTotal == null || lineTotal < 0) return null;
  const basisQty =
    row.priceBasisQty != null && Number(row.priceBasisQty) > 0 ? Number(row.priceBasisQty) : 0;
  if (basisQty <= 0) return null;
  return { lineTotal, basisQty };
}

export function stockAmountFromRow(row: {
  quantity: number;
  stockAmount?: number | null;
  unitCost?: number | null;
  lineTotal?: number | null;
  priceBasisQty?: number | null;
  unitPrice?: number | null;
}): number | null {
  if (row.stockAmount != null && Number.isFinite(row.stockAmount)) return row.stockAmount;
  const basis = basisFromStockRow(row);
  if (!basis) return null;
  return amountForQuantity(basis, Number(row.quantity) || 0);
}
