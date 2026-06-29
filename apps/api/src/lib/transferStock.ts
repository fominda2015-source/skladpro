import { StockCondition, StockMovementDirection, type Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type TransferLine = {
  materialId: string;
  quantity: unknown;
  limitNodeId?: string | null;
};

type TransferCtx = {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  section: "SS" | "EOM";
  lines: TransferLine[];
};

function qtyOf(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function stockRow(
  tx: Prisma.TransactionClient,
  warehouseId: string,
  materialId: string,
  section: "SS" | "EOM"
) {
  return tx.stock.findUnique({
    where: {
      warehouseId_materialId_section_condition: {
        warehouseId,
        materialId,
        section,
        condition: StockCondition.NEW
      }
    },
    include: { material: { select: { name: true, unit: true } } }
  });
}

export async function assertLinesAvailable(transfer: TransferCtx) {
  for (const line of transfer.lines) {
    const need = qtyOf(line.quantity);
    const stock = await stockRow(prisma, transfer.fromWarehouseId, line.materialId, transfer.section);
    if (!stock) {
      throw new Error(`NO_STOCK:${line.materialId}`);
    }
    const available = Number(stock.quantity) - Number(stock.reserved);
    if (available < need - 1e-9) {
      throw new Error(`INSUFFICIENT:${line.materialId}:${available}`);
    }
  }
}

export async function reserveTransferLines(tx: Prisma.TransactionClient, transfer: TransferCtx) {
  for (const line of transfer.lines) {
    const need = qtyOf(line.quantity);
    const key = {
      warehouseId_materialId_section_condition: {
        warehouseId: transfer.fromWarehouseId,
        materialId: line.materialId,
        section: transfer.section,
        condition: StockCondition.NEW
      }
    };
    const stock = await tx.stock.findUnique({ where: key });
    if (!stock) throw new Error(`NO_STOCK:${line.materialId}`);
    const available = Number(stock.quantity) - Number(stock.reserved);
    if (available < need - 1e-9) throw new Error(`INSUFFICIENT:${line.materialId}`);

    await tx.stock.update({
      where: key,
      data: { reserved: { increment: need } }
    });

    if (line.limitNodeId) {
      await tx.objectLimitNode.update({
        where: { id: line.limitNodeId },
        data: { transferredOutQty: { increment: need } }
      });
    }
  }
}

export async function releaseTransferReservations(tx: Prisma.TransactionClient, transfer: TransferCtx) {
  for (const line of transfer.lines) {
    const need = qtyOf(line.quantity);
    const key = {
      warehouseId_materialId_section_condition: {
        warehouseId: transfer.fromWarehouseId,
        materialId: line.materialId,
        section: transfer.section,
        condition: StockCondition.NEW
      }
    };
    const stock = await tx.stock.findUnique({ where: key });
    if (!stock) continue;
    const release = Math.min(Number(stock.reserved), need);
    if (release > 0) {
      await tx.stock.update({
        where: key,
        data: { reserved: { decrement: release } }
      });
    }
    if (line.limitNodeId && release > 0) {
      const node = await tx.objectLimitNode.findUnique({ where: { id: line.limitNodeId } });
      if (node) {
        const dec = Math.min(Number(node.transferredOutQty), release);
        if (dec > 0) {
          await tx.objectLimitNode.update({
            where: { id: line.limitNodeId },
            data: { transferredOutQty: { decrement: dec } }
          });
        }
      }
    }
  }
}

export async function completeTransfer(
  tx: Prisma.TransactionClient,
  transfer: TransferCtx,
  actorUserId: string
) {
  for (const line of transfer.lines) {
    const need = qtyOf(line.quantity);
    const fromKey = {
      warehouseId_materialId_section_condition: {
        warehouseId: transfer.fromWarehouseId,
        materialId: line.materialId,
        section: transfer.section,
        condition: StockCondition.NEW
      }
    };
    const fromStock = await tx.stock.findUnique({ where: fromKey });
    if (!fromStock || Number(fromStock.quantity) < need - 1e-9) {
      throw new Error(`INSUFFICIENT_QTY:${line.materialId}`);
    }
    const reservedRelease = Math.min(Number(fromStock.reserved), need);

    await tx.stock.update({
      where: fromKey,
      data: {
        quantity: { decrement: need },
        ...(reservedRelease > 0 ? { reserved: { decrement: reservedRelease } } : {})
      }
    });

    const toKey = fromKey;
    const toExisting = await tx.stock.findUnique({
      where: {
        warehouseId_materialId_section_condition: {
          warehouseId: transfer.toWarehouseId,
          materialId: line.materialId,
          section: transfer.section,
          condition: StockCondition.NEW
        }
      }
    });
    if (toExisting) {
      await tx.stock.update({
        where: {
          warehouseId_materialId_section_condition: {
            warehouseId: transfer.toWarehouseId,
            materialId: line.materialId,
            section: transfer.section,
            condition: StockCondition.NEW
          }
        },
        data: { quantity: { increment: need } }
      });
    } else {
      await tx.stock.create({
        data: {
          warehouseId: transfer.toWarehouseId,
          materialId: line.materialId,
          section: transfer.section,
          condition: StockCondition.NEW,
          quantity: need,
          reserved: 0
        }
      });
    }

    await tx.stockMovement.create({
      data: {
        warehouseId: transfer.fromWarehouseId,
        materialId: line.materialId,
        quantity: need,
        direction: StockMovementDirection.OUT,
        sourceDocumentType: "TRANSFER_REQUEST",
        sourceDocumentId: transfer.id,
        note: `Перемещение → ${transfer.toWarehouseId}`,
        createdById: actorUserId
      }
    });
    await tx.stockMovement.create({
      data: {
        warehouseId: transfer.toWarehouseId,
        materialId: line.materialId,
        quantity: need,
        direction: StockMovementDirection.IN,
        sourceDocumentType: "TRANSFER_REQUEST",
        sourceDocumentId: transfer.id,
        note: `Перемещение ← ${transfer.fromWarehouseId}`,
        createdById: actorUserId
      }
    });
  }
}

export async function assertToolsTransferable(
  fromWarehouseId: string,
  section: "SS" | "EOM",
  toolIds: string[]
) {
  if (!toolIds.length) return;
  const tools = await prisma.tool.findMany({
    where: { id: { in: toolIds } },
    select: { id: true, name: true, warehouseId: true, section: true, status: true }
  });
  if (tools.length !== toolIds.length) throw new Error("UNKNOWN_TOOL");
  for (const t of tools) {
    if (t.warehouseId !== fromWarehouseId || t.section !== section) {
      throw new Error(`TOOL_WRONG_PLACE:${t.id}`);
    }
    if (t.status !== "IN_STOCK") {
      throw new Error(`TOOL_NOT_AVAILABLE:${t.id}`);
    }
  }
}

export async function assertCampItemsTransferable(
  fromWarehouseId: string,
  section: "SS" | "EOM",
  campItemIds: string[]
) {
  if (!campItemIds.length) return;
  const items = await prisma.campItem.findMany({
    where: { id: { in: campItemIds } },
    select: { id: true, name: true, warehouseId: true, section: true, status: true }
  });
  if (items.length !== campItemIds.length) throw new Error("UNKNOWN_CAMP_ITEM");
  for (const c of items) {
    if (c.warehouseId !== fromWarehouseId || c.section !== section) {
      throw new Error(`CAMP_WRONG_PLACE:${c.id}`);
    }
    if (c.status === "WRITTEN_OFF") {
      throw new Error(`CAMP_NOT_AVAILABLE:${c.id}`);
    }
  }
}

export async function completeToolTransfer(
  tx: Prisma.TransactionClient,
  transfer: Pick<TransferCtx, "id" | "fromWarehouseId" | "toWarehouseId" | "section">,
  toolIds: string[],
  actorUserId: string
) {
  for (const toolId of toolIds) {
    const tool = await tx.tool.findUnique({ where: { id: toolId } });
    if (!tool || tool.warehouseId !== transfer.fromWarehouseId || tool.section !== transfer.section) {
      throw new Error(`TOOL_WRONG_PLACE:${toolId}`);
    }
    if (tool.status !== "IN_STOCK") throw new Error(`TOOL_NOT_AVAILABLE:${toolId}`);
    await tx.tool.update({
      where: { id: toolId },
      data: { warehouseId: transfer.toWarehouseId }
    });
    await tx.toolEvent.create({
      data: {
        toolId,
        action: "TRANSFER_WAREHOUSE",
        status: tool.status,
        comment: `Перемещение ${transfer.fromWarehouseId} → ${transfer.toWarehouseId} (${transfer.section})`,
        actorId: actorUserId
      }
    });
  }
}

export async function completeCampTransfer(
  tx: Prisma.TransactionClient,
  transfer: Pick<TransferCtx, "id" | "fromWarehouseId" | "toWarehouseId" | "section">,
  campItemIds: string[],
  actorUserId: string
) {
  for (const campItemId of campItemIds) {
    const item = await tx.campItem.findUnique({ where: { id: campItemId } });
    if (!item || item.warehouseId !== transfer.fromWarehouseId || item.section !== transfer.section) {
      throw new Error(`CAMP_WRONG_PLACE:${campItemId}`);
    }
    if (item.status === "WRITTEN_OFF") throw new Error(`CAMP_NOT_AVAILABLE:${campItemId}`);
    await tx.campItem.update({
      where: { id: campItemId },
      data: { warehouseId: transfer.toWarehouseId }
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "CAMP_ITEM_UPDATE",
        entityType: "CampItem",
        entityId: campItemId,
        summary: `Перемещение городка: ${item.name} → объект ${transfer.toWarehouseId}`,
        beforeData: item as unknown as Prisma.InputJsonValue,
        afterData: { ...item, warehouseId: transfer.toWarehouseId } as unknown as Prisma.InputJsonValue
      }
    });
  }
}
