import { parseMaterialQty } from "../../shared/quantity";

const PACK_UNIT_RE = /^(упаковка|уп\.?|pack|pkg)$/i;

export function isPackReceiptUnit(unit: string | null | undefined): boolean {
  const u = String(unit || "").trim().toLowerCase();
  if (!u) return false;
  if (PACK_UNIT_RE.test(u)) return true;
  return u.includes("упак");
}

/** Упаковка по заявке/УПД, даже если карточка материала уже в «шт». */
export function receiptItemUsesPackUnit(
  orderUnit: string | null | undefined,
  displayUnit?: string | null | undefined
): boolean {
  return isPackReceiptUnit(orderUnit) || isPackReceiptUnit(displayUnit);
}

export function receiptStockQtyPreview(packQty: unknown, unitsPerPack: unknown): number | null {
  const packs = parseMaterialQty(packQty);
  const perPack = parseMaterialQty(unitsPerPack);
  if (packs <= 0 || perPack <= 0) return null;
  return packs * perPack;
}
