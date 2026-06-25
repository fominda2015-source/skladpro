import {
  OperationType,
  StockCondition,
  StockMovementDirection,
  type Prisma,
  type ReceiptItemCategory
} from "@prisma/client";
import { receiptCategoryToCampCategory } from "./campCatalog.js";
import { prisma } from "./prisma.js";
import { receiptAcceptedQty } from "./receiptQty.js";
import { resolveReceiptStockQty } from "./receiptUnits.js";
import {
  canonicalReceiptMaterialName,
  catalogArticleToken,
  mappedMaterialMatchesCatalog
} from "./receiptMaterialResolve.js";
import { resolveMaterialIdForLimitNode } from "./receiptOverageLimits.js";
import {
  isToolCatalogMaterialReceiptCategory,
  isToolInventoryReceiptCategory
} from "./receiptToolApply.js";

type ReconcileTx = Prisma.TransactionClient;

export type ReceiptStockReconcileResult = {
  materialsChecked: number;
  stockLinesCreated: number;
  stockLinesUpdated: number;
  quantityAdded: number;
  operationsCreated: number;
  acceptedItemsSeen: number;
  unresolvedItems: number;
  warnings: string[];
  details: Array<{
    warehouseId: string;
    section: "SS" | "EOM";
    materialId: string;
    materialName: string;
    receiptBackedQty: number;
    operationBackedQty: number;
    stockBefore: number;
    addedQty: number;
  }>;
};

type MaterialKey = `${string}:${"SS" | "EOM"}:${string}`;

function materialKey(warehouseId: string, section: "SS" | "EOM", materialId: string): MaterialKey {
  return `${warehouseId}:${section}:${materialId}`;
}

function isWarehouseReceiptCategory(cat: ReceiptItemCategory | null | undefined): boolean {
  if (!cat) return true;
  if (receiptCategoryToCampCategory(cat)) return false;
  if (isToolInventoryReceiptCategory(cat)) return false;
  if (isToolCatalogMaterialReceiptCategory(cat)) return false;
  return true;
}

function itemStockQtyFromAccepted(item: {
  acceptedQty: unknown;
  sourceUnit: string;
  factUnit?: string | null;
}): number {
  const accepted = receiptAcceptedQty(item.acceptedQty);
  if (accepted <= 0) return 0;
  try {
    return resolveReceiptStockQty({
      acceptedQty: accepted,
      orderUnit: item.sourceUnit,
      displayUnit: item.factUnit || item.sourceUnit
    }).stockQty;
  } catch {
    return accepted;
  }
}

type ReconcileItemRow = {
  id: string;
  acceptedQty: unknown;
  sourceName: string;
  sourceUnit: string;
  factUnit?: string | null;
  category: ReceiptItemCategory | null;
  mappedMaterialId: string | null;
  limitNodeId: string | null;
  limitCatalogNameN: string | null;
  limitCatalogNameO: string | null;
  namePartD: string | null;
  namePartE: string | null;
  externalComment: string | null;
  receiptRequest: {
    id: string;
    number: string;
    warehouseId: string;
    section: "SS" | "EOM";
  };
};

async function resolveMaterialForReconcileItem(
  tx: ReconcileTx,
  item: ReconcileItemRow
): Promise<string | null> {
  const commit = async (materialId: string) => {
    await tx.receiptRequestItem.update({
      where: { id: item.id },
      data: { mappedMaterialId: materialId }
    });
    return materialId;
  };

  if (item.mappedMaterialId) {
    const mapped = await tx.material.findUnique({
      where: { id: item.mappedMaterialId },
      select: { name: true }
    });
    if (mapped && mappedMaterialMatchesCatalog(mapped.name, item)) {
      return item.mappedMaterialId;
    }
  }

  if (item.limitNodeId) {
    const fromNode = await resolveMaterialIdForLimitNode(tx, item.limitNodeId);
    if (fromNode) {
      const mapped = await tx.material.findUnique({
        where: { id: fromNode },
        select: { name: true }
      });
      if (mapped && mappedMaterialMatchesCatalog(mapped.name, item)) {
        return commit(fromNode);
      }
    }
  }

  const { warehouseId, section } = item.receiptRequest;
  const unit = (item.sourceUnit || "шт").trim() || "шт";
  const canon = canonicalReceiptMaterialName(item);

  const mapping = await tx.materialMappingLibrary.findFirst({
    where: {
      warehouseId,
      section,
      OR: [
        { sourceName: { equals: canon, mode: "insensitive" } },
        { sourceName: { equals: item.sourceName.trim(), mode: "insensitive" } }
      ]
    },
    select: { targetMaterialId: true },
    orderBy: { updatedAt: "desc" }
  });
  if (mapping?.targetMaterialId) {
    const mapped = await tx.material.findUnique({
      where: { id: mapping.targetMaterialId },
      select: { name: true }
    });
    if (mapped && mappedMaterialMatchesCatalog(mapped.name, item)) {
      return commit(mapping.targetMaterialId);
    }
  }

  for (const name of [canon, item.sourceName.trim(), (item.limitCatalogNameO || "").trim()].filter(Boolean)) {
    const mat = await tx.material.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        unit: { equals: unit, mode: "insensitive" }
      },
      select: { id: true }
    });
    if (mat) {
      return commit(mat.id);
    }
  }

  const article = catalogArticleToken(canon) || catalogArticleToken(item.sourceName);
  if (article) {
    const stocks = await tx.stock.findMany({
      where: {
        warehouseId,
        section,
        material: { unit: { equals: unit, mode: "insensitive" } }
      },
      include: { material: { select: { id: true, name: true } } },
      take: 200
    });
    for (const row of stocks) {
      if (catalogArticleToken(row.material.name) !== article) continue;
      if (!mappedMaterialMatchesCatalog(row.material.name, item)) continue;
      return commit(row.material.id);
    }
    const mats = await tx.material.findMany({
      where: { unit: { equals: unit, mode: "insensitive" } },
      select: { id: true, name: true },
      take: 300
    });
    for (const mat of mats) {
      if (catalogArticleToken(mat.name) !== article) continue;
      if (!mappedMaterialMatchesCatalog(mat.name, item)) continue;
      return commit(mat.id);
    }
  }

  if (!canon) return null;

  const created = await tx.material.create({
    data: { name: canon, unit }
  });
  return commit(created.id);
}

/**
 * Восстанавливает остатки по принятым позициям заявок, если приёмка обновила acceptedQty,
 * но складской приход не был создан (закрытие заявки, «без склада», правка без карточки и т.п.).
 */
export async function reconcileReceiptWarehouseStock(opts?: {
  warehouseId?: string;
  section?: "SS" | "EOM";
  dryRun?: boolean;
  tx?: ReconcileTx;
}): Promise<ReceiptStockReconcileResult> {
  const run = async (tx: ReconcileTx) => {
    const items = await tx.receiptRequestItem.findMany({
      where: {
        acceptedQty: { gt: 0 },
        receiptRequest: {
          status: { not: "CANCELLED" },
          ...(opts?.warehouseId ? { warehouseId: opts.warehouseId } : {}),
          ...(opts?.section ? { section: opts.section } : {})
        }
      },
      select: {
        id: true,
        acceptedQty: true,
        sourceName: true,
        sourceUnit: true,
        factUnit: true,
        category: true,
        mappedMaterialId: true,
        limitNodeId: true,
        limitCatalogNameN: true,
        limitCatalogNameO: true,
        namePartD: true,
        namePartE: true,
        externalComment: true,
        receiptRequest: {
          select: {
            id: true,
            number: true,
            warehouseId: true,
            section: true
          }
        }
      }
    });

    const result: ReceiptStockReconcileResult = {
      materialsChecked: 0,
      stockLinesCreated: 0,
      stockLinesUpdated: 0,
      quantityAdded: 0,
      operationsCreated: 0,
      acceptedItemsSeen: items.length,
      unresolvedItems: 0,
      warnings: [],
      details: []
    };

    const receiptBacked = new Map<MaterialKey, number>();
    const receiptNumbersByWh = new Map<string, Set<string>>();

    for (const item of items) {
      if (!isWarehouseReceiptCategory(item.category)) continue;
      const materialId = await resolveMaterialForReconcileItem(tx, item);
      if (!materialId) {
        result.unresolvedItems += 1;
        continue;
      }
      const stockQty = itemStockQtyFromAccepted(item);
      if (stockQty <= 0) continue;
      const { warehouseId, section } = item.receiptRequest;
      const key = materialKey(warehouseId, section, materialId);
      receiptBacked.set(key, (receiptBacked.get(key) ?? 0) + stockQty);
      const whKey = `${warehouseId}:${section}`;
      const nums = receiptNumbersByWh.get(whKey) ?? new Set<string>();
      nums.add(item.receiptRequest.number);
      receiptNumbersByWh.set(whKey, nums);
    }

    if (result.unresolvedItems > 0) {
      result.warnings.push(
        `Не удалось сопоставить ${result.unresolvedItems} принятых позиций с карточкой материала`
      );
    }

    result.materialsChecked = receiptBacked.size;

    if (!receiptBacked.size) {
      if (result.acceptedItemsSeen > 0 && result.unresolvedItems === 0) {
        result.warnings.push(
          "Принятые позиции найдены, но остатки уже соответствуют приходам — изменений не требуется"
        );
      }
      return result;
    }

    const materialIds = [...new Set([...receiptBacked.keys()].map((k) => k.split(":")[2]!))];
    const materials = await tx.material.findMany({
      where: { id: { in: materialIds } },
      select: { id: true, name: true }
    });
    const materialNameById = new Map(materials.map((m) => [m.id, m.name]));

    for (const [key, receiptBackedQty] of receiptBacked) {
      const [warehouseId, section, materialId] = key.split(":") as [string, "SS" | "EOM", string];
      const whSectionKey = `${warehouseId}:${section}`;
      const receiptNumbers = [...(receiptNumbersByWh.get(whSectionKey) ?? [])];

      const incomeOps = receiptNumbers.length
        ? await tx.operation.findMany({
            where: {
              type: OperationType.INCOME,
              warehouseId,
              section,
              documentNumber: { in: receiptNumbers },
              items: { some: { materialId } }
            },
            include: { items: { where: { materialId } } }
          })
        : [];

      const operationBackedQty = incomeOps.reduce(
        (sum, op) => sum + op.items.reduce((s, it) => s + Number(it.quantity), 0),
        0
      );

      const stockRow = await tx.stock.findUnique({
        where: {
          warehouseId_materialId_section_condition: {
            warehouseId,
            materialId,
            section,
            condition: StockCondition.NEW
          }
        }
      });
      const stockBefore = stockRow ? Number(stockRow.quantity) : 0;
      // Ориентир — принятое количество и фактический остаток; операция могла создаться без stock (старый баг).
      const addedQty = Math.max(0, receiptBackedQty - stockBefore);
      if (addedQty <= 1e-6) continue;

      const materialName = materialNameById.get(materialId) ?? materialId;
      result.details.push({
        warehouseId,
        section,
        materialId,
        materialName,
        receiptBackedQty,
        operationBackedQty,
        stockBefore,
        addedQty
      });

      if (opts?.dryRun) {
        result.quantityAdded += addedQty;
        continue;
      }

      let operationId: string | null = incomeOps[0]?.id ?? null;
      if (!operationId) {
        const op = await tx.operation.create({
          data: {
            type: OperationType.INCOME,
            warehouseId,
            section,
            documentNumber: `RECONCILE-${new Date().toISOString().slice(0, 10)}`,
            status: "POSTED",
            items: {
              create: [{ materialId, quantity: addedQty }]
            }
          }
        });
        operationId = op.id;
        result.operationsCreated += 1;
      }

      if (stockRow) {
        await tx.stock.update({
          where: {
            warehouseId_materialId_section_condition: {
              warehouseId,
              materialId,
              section,
              condition: StockCondition.NEW
            }
          },
          data: { quantity: { increment: addedQty } }
        });
        result.stockLinesUpdated += 1;
      } else {
        await tx.stock.create({
          data: {
            warehouseId,
            section,
            materialId,
            condition: StockCondition.NEW,
            quantity: addedQty,
            reserved: 0
          }
        });
        result.stockLinesCreated += 1;
      }

      await tx.stockMovement.create({
        data: {
          warehouseId,
          materialId,
          quantity: addedQty,
          direction: StockMovementDirection.IN,
          sourceDocumentType: "RECEIPT_STOCK_RECONCILE",
          sourceDocumentId: operationId,
          operationId,
          note: `Восстановление остатка по принятым заявкам (${materialName})`
        }
      });

      result.quantityAdded += addedQty;
    }

    return result;
  };

  if (opts?.tx) return run(opts.tx);
  return prisma.$transaction(run, { maxWait: 15_000, timeout: 120_000 });
}
