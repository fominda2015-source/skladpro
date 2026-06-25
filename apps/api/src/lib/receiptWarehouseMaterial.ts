import { StockCondition, type ObjectSection, type Prisma } from "@prisma/client";
import {
  canonicalReceiptMaterialName,
  catalogArticleToken,
  materialNamesEquivalent,
  type ReceiptCatalogItem
} from "./receiptMaterialResolve.js";

type WarehouseTx = Prisma.TransactionClient;

export type ConsolidateReceiptMaterialOpts = {
  materialId: string;
  item: ReceiptCatalogItem & {
    sourceUnit: string;
    limitCatalogNameN?: string | null;
  };
  limitNodeId?: string | null;
  warehouseId: string;
  section: ObjectSection;
};

async function findMaterialByNameUnit(
  tx: WarehouseTx,
  name: string,
  unit: string
): Promise<{ id: string; name: string } | null> {
  const n = name.trim();
  if (!n) return null;
  const u = (unit || "шт").trim() || "шт";
  return tx.material.findFirst({
    where: {
      name: { equals: n, mode: "insensitive" },
      unit: { equals: u, mode: "insensitive" }
    },
    select: { id: true, name: true }
  });
}

/** Имя карточки склада: сначала materialName узла лимита (уже переименован в O), затем канон из заявки. */
export async function warehouseCardNameForReceipt(
  tx: WarehouseTx,
  item: ReceiptCatalogItem,
  limitNodeId?: string | null
): Promise<string> {
  if (limitNodeId) {
    const node = await tx.objectLimitNode.findUnique({
      where: { id: limitNodeId },
      select: { materialName: true, title: true }
    });
    const fromNode = String(node?.materialName || node?.title || "").trim();
    if (fromNode) return fromNode;
  }
  return canonicalReceiptMaterialName(item);
}

export async function mergeWarehouseStockBetweenMaterials(
  tx: WarehouseTx,
  opts: {
    fromMaterialId: string;
    toMaterialId: string;
    warehouseId: string;
    section: ObjectSection;
  }
): Promise<number> {
  const { fromMaterialId, toMaterialId, warehouseId, section } = opts;
  if (fromMaterialId === toMaterialId) return 0;

  const stockKey = {
    warehouseId_materialId_section_condition: {
      warehouseId,
      materialId: fromMaterialId,
      section,
      condition: StockCondition.NEW
    }
  };
  const fromStock = await tx.stock.findUnique({ where: stockKey });
  if (!fromStock) return 0;
  const moveQty = Number(fromStock.quantity);
  if (moveQty <= 1e-6) return 0;

  const toKey = {
    warehouseId_materialId_section_condition: {
      warehouseId,
      materialId: toMaterialId,
      section,
      condition: StockCondition.NEW
    }
  };
  const toStock = await tx.stock.findUnique({ where: toKey });
  if (toStock) {
    await tx.stock.update({
      where: toKey,
      data: {
        quantity: { increment: moveQty },
        ...(fromStock.storageRoom && !toStock.storageRoom ? { storageRoom: fromStock.storageRoom } : {}),
        ...(fromStock.storageCell && !toStock.storageCell ? { storageCell: fromStock.storageCell } : {})
      }
    });
  } else {
    await tx.stock.create({
      data: {
        warehouseId,
        section,
        materialId: toMaterialId,
        condition: StockCondition.NEW,
        quantity: moveQty,
        reserved: 0,
        storageRoom: fromStock.storageRoom,
        storageCell: fromStock.storageCell
      }
    });
  }

  await tx.stock.update({
    where: stockKey,
    data: { quantity: 0, reserved: 0 }
  });

  await tx.receiptRequestItem.updateMany({
    where: { mappedMaterialId: fromMaterialId },
    data: { mappedMaterialId: toMaterialId }
  });
  await tx.objectLimitNode.updateMany({
    where: { materialId: fromMaterialId },
    data: { materialId: toMaterialId }
  });

  const fromBindings = await tx.stockMaterialLimitBinding.findMany({
    where: { warehouseId, section, materialId: fromMaterialId }
  });
  for (const b of fromBindings) {
    const keeperBinding = await tx.stockMaterialLimitBinding.findUnique({
      where: {
        warehouseId_section_materialId_limitNodeId: {
          warehouseId,
          section,
          materialId: toMaterialId,
          limitNodeId: b.limitNodeId
        }
      }
    });
    if (keeperBinding) {
      await tx.stockMaterialLimitBinding.delete({ where: { id: b.id } });
    } else {
      await tx.stockMaterialLimitBinding.update({
        where: { id: b.id },
        data: { materialId: toMaterialId }
      });
    }
  }

  await tx.materialMappingLibrary.updateMany({
    where: { warehouseId, section, targetMaterialId: fromMaterialId },
    data: { targetMaterialId: toMaterialId }
  });

  return moveQty;
}

/**
 * После resolveReceiptTargetMaterialId: одна карточка с именем из лимита (O),
 * слияние дубликатов по артикулу / эквивалентному названию.
 */
export async function consolidateReceiptWarehouseMaterial(
  tx: WarehouseTx,
  opts: ConsolidateReceiptMaterialOpts
): Promise<string> {
  const { warehouseId, section } = opts;
  let materialId = opts.materialId;
  const targetName = await warehouseCardNameForReceipt(tx, opts.item, opts.limitNodeId);
  const unit = opts.item.sourceUnit || "шт";

  const current = await tx.material.findUnique({
    where: { id: materialId },
    select: { id: true, name: true, unit: true }
  });
  if (!current) return materialId;

  let canonicalId: string | null = null;
  if (targetName) {
    const byName = await findMaterialByNameUnit(tx, targetName, unit);
    if (byName) canonicalId = byName.id;
  }

  if (!canonicalId) {
    const article = catalogArticleToken(targetName) || catalogArticleToken(current.name);
    if (article) {
      const peers = await tx.stock.findMany({
        where: {
          warehouseId,
          section,
          quantity: { gt: 0 },
          material: { unit: { equals: unit, mode: "insensitive" } }
        },
        include: { material: { select: { id: true, name: true } } },
        take: 200
      });
      for (const row of peers) {
        if (catalogArticleToken(row.material.name) !== article) continue;
        if (targetName && materialNamesEquivalent(row.material.name, targetName)) {
          canonicalId = row.material.id;
          break;
        }
        if (!canonicalId) canonicalId = row.material.id;
      }
    }
  }

  if (canonicalId && canonicalId !== materialId) {
    await mergeWarehouseStockBetweenMaterials(tx, {
      fromMaterialId: materialId,
      toMaterialId: canonicalId,
      warehouseId,
      section
    });
    materialId = canonicalId;
  }

  if (targetName) {
    const mat = await tx.material.findUnique({
      where: { id: materialId },
      select: { id: true, name: true }
    });
    if (mat && !materialNamesEquivalent(mat.name, targetName)) {
      const conflict = await findMaterialByNameUnit(tx, targetName, unit);
      if (!conflict || conflict.id === materialId) {
        await tx.material.update({
          where: { id: materialId },
          data: { name: targetName }
        });
      }
    }
  }

  if (opts.limitNodeId) {
    await tx.objectLimitNode.updateMany({
      where: { id: opts.limitNodeId },
      data: { materialId }
    });
  }

  return materialId;
}

export type MergeDuplicateMaterialsResult = {
  groupsFound: number;
  materialsMerged: number;
  quantityMoved: number;
  details: Array<{
    article: string;
    keptMaterialId: string;
    keptName: string;
    mergedIds: string[];
    quantityMoved: number;
  }>;
};

/** Слияние уже созданных дубликатов карточек с одним артикулом на складе объекта. */
export async function mergeDuplicateWarehouseMaterialsByArticle(opts?: {
  warehouseId?: string;
  section?: ObjectSection;
  dryRun?: boolean;
  tx?: WarehouseTx;
}): Promise<MergeDuplicateMaterialsResult> {
  const run = async (tx: WarehouseTx): Promise<MergeDuplicateMaterialsResult> => {
    const result: MergeDuplicateMaterialsResult = {
      groupsFound: 0,
      materialsMerged: 0,
      quantityMoved: 0,
      details: []
    };

    const stocks = await tx.stock.findMany({
      where: {
        quantity: { gt: 0 },
        ...(opts?.warehouseId ? { warehouseId: opts.warehouseId } : {}),
        ...(opts?.section ? { section: opts.section } : {})
      },
      include: { material: { select: { id: true, name: true, unit: true } } }
    });

    const byArticle = new Map<string, typeof stocks>();
    for (const row of stocks) {
      const article = catalogArticleToken(row.material.name);
      if (!article) continue;
      const key = `${row.warehouseId}:${row.section}:${article}:${(row.material.unit || "шт").toLowerCase()}`;
      const bucket = byArticle.get(key) || [];
      bucket.push(row);
      byArticle.set(key, bucket);
    }

    for (const [, rows] of byArticle) {
      const materialIds = [...new Set(rows.map((r) => r.materialId))];
      if (materialIds.length < 2) continue;

      result.groupsFound += 1;
      const warehouseId = rows[0]!.warehouseId;
      const section = rows[0]!.section;

      const limitNodes = await tx.objectLimitNode.findMany({
        where: {
          nodeType: "MATERIAL",
          materialId: { in: materialIds },
          template: { warehouseId, section }
        },
        select: { materialId: true, materialName: true }
      });
      const nodeNameByMat = new Map(
        limitNodes.filter((n) => n.materialId).map((n) => [n.materialId!, n.materialName || ""])
      );

      let keeperId = materialIds[0]!;
      let keeperName = rows.find((r) => r.materialId === keeperId)?.material.name || keeperId;
      for (const id of materialIds) {
        const nodeName = nodeNameByMat.get(id)?.trim();
        const matName = rows.find((r) => r.materialId === id)?.material.name || "";
        if (nodeName && materialNamesEquivalent(matName, nodeName)) {
          keeperId = id;
          keeperName = nodeName;
          break;
        }
      }
      if (!nodeNameByMat.has(keeperId)) {
        for (const id of materialIds) {
          if (nodeNameByMat.has(id)) {
            keeperId = id;
            keeperName = nodeNameByMat.get(id) || keeperName;
            break;
          }
        }
      }

      const mergedIds: string[] = [];
      let moved = 0;
      for (const id of materialIds) {
        if (id === keeperId) continue;
        mergedIds.push(id);
        if (!opts?.dryRun) {
          moved += await mergeWarehouseStockBetweenMaterials(tx, {
            fromMaterialId: id,
            toMaterialId: keeperId,
            warehouseId,
            section
          });
          const nodeName = nodeNameByMat.get(keeperId)?.trim();
          if (nodeName) {
            await tx.material.update({
              where: { id: keeperId },
              data: { name: nodeName }
            });
            keeperName = nodeName;
          }
        } else {
          const fromQty = rows
            .filter((r) => r.materialId === id)
            .reduce((s, r) => s + Number(r.quantity), 0);
          moved += fromQty;
        }
      }

      result.materialsMerged += mergedIds.length;
      result.quantityMoved += moved;
      result.details.push({
        article: catalogArticleToken(keeperName) || "?",
        keptMaterialId: keeperId,
        keptName: keeperName,
        mergedIds,
        quantityMoved: moved
      });
    }

    return result;
  };

  if (opts?.tx) return run(opts.tx);
  const { prisma } = await import("./prisma.js");
  return prisma.$transaction(run, { maxWait: 15_000, timeout: 120_000 });
}
