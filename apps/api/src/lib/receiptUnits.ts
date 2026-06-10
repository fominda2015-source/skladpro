import { materialQtyCoerceSchema } from "./quantity.js";

const PACK_UNIT_RE = /^(упаковка|уп\.?|pack|pkg)$/i;

/** Ед. изм. «упаковка» и близкие варианты из заявки / УПД. */
export function isPackReceiptUnit(unit: string | null | undefined): boolean {
  const u = String(unit || "").trim().toLowerCase();
  if (!u) return false;
  if (PACK_UNIT_RE.test(u)) return true;
  return u.includes("упак");
}

export const unitsPerPackSchema = materialQtyCoerceSchema;

/** Кол-во для склада: упаковки × штук в упаковке. */
export function resolveReceiptStockQty(opts: {
  acceptedQty: number;
  sourceUnit: string;
  unitsPerPack?: number | null;
}): { stockQty: number; unitsPerPack: number | null } {
  const acceptedQty = Math.max(0, Math.round(opts.acceptedQty));
  if (!isPackReceiptUnit(opts.sourceUnit)) {
    return { stockQty: acceptedQty, unitsPerPack: null };
  }
  const perPack =
    opts.unitsPerPack != null && Number.isFinite(Number(opts.unitsPerPack))
      ? Math.round(Number(opts.unitsPerPack))
      : 0;
  if (perPack <= 0) {
    throw Object.assign(new Error("Укажите количество в упаковке (шт/уп)"), { status: 400 });
  }
  return { stockQty: acceptedQty * perPack, unitsPerPack: perPack };
}
