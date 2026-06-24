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
        acceptedQty: true,
        sourceName: true,
        sourceUnit: true,
        factUnit: true,
        category: true,
        mappedMaterialId: true,
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

    const receiptBacked = new Map<MaterialKey, number>();
    const receiptNumbersByWh = new Map<string, Set<string>>();

    for (const item of items) {
      if (!isWarehouseReceiptCategory(item.category)) continue;
      let materialId = item.mappedMaterialId;
      if (!materialId) {
        const sourceName = item.sourceName.trim();
        if (!sourceName) continue;
        const mapping = await tx.materialMappingLibrary.findFirst({
          where: {
            warehouseId: item.receiptRequest.warehouseId,
            section: item.receiptRequest.section,
            sourceName: { equals: sourceName, mode: "insensitive" }
          },
          select: { targetMaterialId: true },
          orderBy: { updatedAt: "desc" }
        });
        materialId = mapping?.targetMaterialId ?? null;
        if (!materialId) {
          const mat = await tx.material.findFirst({
            where: {
              name: { equals: sourceName, mode: "insensitive" },
              unit: { equals: (item.sourceUnit || "шт").trim() || "шт", mode: "insensitive" }
            },
            select: { id: true }
          });
          materialId = mat?.id ?? null;
        }
        if (!materialId) continue;
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

    const result: ReceiptStockReconcileResult = {
      materialsChecked: receiptBacked.size,
      stockLinesCreated: 0,
      stockLinesUpdated: 0,
      quantityAdded: 0,
      operationsCreated: 0,
      details: []
    };

    if (!receiptBacked.size) return result;

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
      const targetQty = Math.max(receiptBackedQty, operationBackedQty);
      const addedQty = Math.max(0, targetQty - stockBefore);
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
