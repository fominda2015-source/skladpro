import { prisma } from "./prisma.js";

/** Сумма за `basisQty` единиц (из прихода или карточки). Поле Material.unitPrice хранит эту сумму. */
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

/** Загружает базу цены: сумма за кол-во из карточки или последнего прихода. */
export async function loadMaterialPriceBasisMap(
  materialIds: string[]
): Promise<Map<string, MaterialPriceBasis>> {
  const result = new Map<string, MaterialPriceBasis>();
  if (!materialIds.length) return result;

  const materials = await prisma.material.findMany({
    where: { id: { in: materialIds } },
    select: { id: true, unitPrice: true, priceBasisQty: true }
  });

  const needReceipt = new Set<string>();

  for (const m of materials) {
    const lineTotal = m.unitPrice != null ? Number(m.unitPrice) : Number.NaN;
    const basisQty = m.priceBasisQty != null ? Number(m.priceBasisQty) : 0;
    if (Number.isFinite(lineTotal) && lineTotal >= 0 && basisQty > 0) {
      result.set(m.id, { lineTotal, basisQty });
    } else if (Number.isFinite(lineTotal) && lineTotal >= 0) {
      result.set(m.id, { lineTotal, basisQty: 0 });
      needReceipt.add(m.id);
    } else {
      needReceipt.add(m.id);
    }
  }

  for (const id of materialIds) {
    if (!result.has(id)) needReceipt.add(id);
  }

  if (needReceipt.size) {
    const items = await prisma.receiptRequestItem.findMany({
      where: {
        mappedMaterialId: { in: [...needReceipt] },
        unitPrice: { not: null }
      },
      orderBy: { updatedAt: "desc" },
      select: {
        mappedMaterialId: true,
        unitPrice: true,
        quantity: true,
        acceptedQty: true
      }
    });

    const receiptByMaterial = new Map<string, MaterialPriceBasis>();
    for (const it of items) {
      const materialId = it.mappedMaterialId;
      if (!materialId || receiptByMaterial.has(materialId)) continue;
      const lineTotal = Number(it.unitPrice);
      const basisQty = Number(it.acceptedQty ?? it.quantity) || 0;
      if (!Number.isFinite(lineTotal) || lineTotal < 0 || basisQty <= 0) continue;
      receiptByMaterial.set(materialId, { lineTotal, basisQty });
    }

    for (const materialId of needReceipt) {
      const fromReceipt = receiptByMaterial.get(materialId);
      const fromCard = result.get(materialId);
      if (fromCard && fromCard.basisQty <= 0 && fromCard.lineTotal >= 0) {
        if (fromReceipt) {
          result.set(materialId, { lineTotal: fromCard.lineTotal, basisQty: fromReceipt.basisQty });
        }
      } else if (!fromCard && fromReceipt) {
        result.set(materialId, fromReceipt);
      }
    }
  }

  for (const [id, basis] of [...result.entries()]) {
    if (basis.basisQty <= 0) result.delete(id);
  }

  return result;
}

export type MaterialAmountLine = {
  catalogLineTotal: number | null;
  priceBasisQty: number | null;
  unitCost: number | null;
  totalAmount: number | null;
};

export function materialAmountsForQty(
  basis: MaterialPriceBasis | undefined,
  qty: number
): MaterialAmountLine {
  if (!basis) {
    return { catalogLineTotal: null, priceBasisQty: null, unitCost: null, totalAmount: null };
  }
  const unitCost = unitCostFromBasis(basis);
  return {
    catalogLineTotal: basis.lineTotal,
    priceBasisQty: basis.basisQty,
    unitCost,
    totalAmount: qty > 0 ? amountForQuantity(basis, qty) : null
  };
}
