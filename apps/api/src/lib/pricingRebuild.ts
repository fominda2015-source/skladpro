import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { isToolInventoryReceiptCategory } from "./receiptToolApply.js";

export type PricingRebuildStats = {
  fromReceipt: number;
  fromLegacyCard: number;
  cleared: number;
  skipped: number;
  toolPrices: number;
};

type ReceiptPrice = { lineTotal: number; basisQty: number };

/** Последняя сумма по приходу для материала (источник истины для старых приходов). */
export async function loadLatestReceiptPricesByMaterial(): Promise<Map<string, ReceiptPrice>> {
  const items = await prisma.receiptRequestItem.findMany({
    where: {
      mappedMaterialId: { not: null },
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

  const byMaterial = new Map<string, ReceiptPrice>();
  for (const it of items) {
    const materialId = it.mappedMaterialId;
    if (!materialId || byMaterial.has(materialId)) continue;
    const basisQty = Number(it.acceptedQty ?? it.quantity) || 0;
    const lineTotal = Number(it.unitPrice);
    if (!Number.isFinite(lineTotal) || lineTotal < 0 || basisQty <= 0) continue;
    byMaterial.set(materialId, { lineTotal, basisQty });
  }
  return byMaterial;
}

function stockQtySum(stocks: Array<{ quantity: unknown }>): number {
  const sum = stocks.reduce((n, s) => n + (Number(s.quantity) || 0), 0);
  return sum > 0 ? sum : 1;
}

/**
 * Переформировывает Material.unitPrice + priceBasisQty под текущие правила:
 * unitPrice = сумма за priceBasisQty (не за 1 шт.).
 *
 * Приоритет:
 * 1) последний приход с суммой;
 * 2) legacy-карточка: старое unitPrice считалось ₽/ед. → переводим в сумму за остаток.
 */
export async function rebuildMaterialPricing(): Promise<PricingRebuildStats> {
  const stats: PricingRebuildStats = {
    fromReceipt: 0,
    fromLegacyCard: 0,
    cleared: 0,
    skipped: 0,
    toolPrices: 0
  };

  const receiptPrices = await loadLatestReceiptPricesByMaterial();

  const materials = await prisma.material.findMany({
    select: {
      id: true,
      unitPrice: true,
      priceBasisQty: true,
      stocks: { select: { quantity: true } }
    }
  });

  const updates: Array<{ id: string; data: Prisma.MaterialUpdateInput }> = [];

  for (const m of materials) {
    const fromReceipt = receiptPrices.get(m.id);
    if (fromReceipt) {
      const curTotal = m.unitPrice != null ? Number(m.unitPrice) : null;
      const curBasis = m.priceBasisQty != null ? Number(m.priceBasisQty) : null;
      if (
        curTotal === fromReceipt.lineTotal &&
        curBasis === fromReceipt.basisQty
      ) {
        stats.skipped += 1;
        continue;
      }
      updates.push({
        id: m.id,
        data: {
          unitPrice: fromReceipt.lineTotal,
          priceBasisQty: fromReceipt.basisQty
        }
      });
      stats.fromReceipt += 1;
      continue;
    }

    if (m.unitPrice == null) {
      if (m.priceBasisQty != null) {
        updates.push({ id: m.id, data: { priceBasisQty: null } });
        stats.cleared += 1;
      } else {
        stats.skipped += 1;
      }
      continue;
    }

    // Уже в новом формате (заполнено после приёмки или прошлого rebuild).
    if (m.priceBasisQty != null && Number(m.priceBasisQty) > 0) {
      stats.skipped += 1;
      continue;
    }

    const oldPerUnit = Number(m.unitPrice);
    if (!Number.isFinite(oldPerUnit) || oldPerUnit < 0) {
      updates.push({ id: m.id, data: { unitPrice: null, priceBasisQty: null } });
      stats.cleared += 1;
      continue;
    }

    const basisQty = stockQtySum(m.stocks);
    const lineTotal = oldPerUnit * basisQty;
    const curTotal = Number(m.unitPrice);
    const curBasis = m.priceBasisQty != null ? Number(m.priceBasisQty) : null;
    if (curTotal === lineTotal && curBasis === basisQty) {
      stats.skipped += 1;
      continue;
    }

    updates.push({
      id: m.id,
      data: {
        unitPrice: lineTotal,
        priceBasisQty: basisQty
      }
    });
    stats.fromLegacyCard += 1;
  }

  const BATCH = 100;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((u) => prisma.material.update({ where: { id: u.id }, data: u.data }))
    );
  }

  return stats;
}

/** Стоимость Tool из суммы строки прихода (инструмент / СИЗ). */
export async function rebuildToolPurchasePrices(): Promise<number> {
  const items = await prisma.receiptRequestItem.findMany({
    where: {
      unitPrice: { not: null },
      category: { not: null }
    },
    select: {
      id: true,
      unitPrice: true,
      quantity: true,
      acceptedQty: true,
      category: true
    }
  });

  let updated = 0;
  for (const it of items) {
    if (!isToolInventoryReceiptCategory(it.category)) continue;
    const qty = Number(it.acceptedQty ?? it.quantity) || 0;
    const lineTotal = Number(it.unitPrice);
    if (!Number.isFinite(lineTotal) || lineTotal < 0 || qty <= 0) continue;
    const perUnit = lineTotal / qty;
    const suffix = it.id.slice(-6);
    const tools = await prisma.tool.findMany({
      where: {
        purchasePrice: null,
        inventoryNumber: { contains: suffix }
      },
      select: { id: true }
    });
    if (!tools.length) continue;
    await prisma.tool.updateMany({
      where: { id: { in: tools.map((t) => t.id) } },
      data: { purchasePrice: perUnit }
    });
    updated += tools.length;
  }
  return updated;
}

export async function rebuildAllPricing(): Promise<PricingRebuildStats> {
  const materialStats = await rebuildMaterialPricing();
  materialStats.toolPrices = await rebuildToolPurchasePrices();
  return materialStats;
}
