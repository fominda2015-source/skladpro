import {
  IssueRequestDomain,
  IssueRequestStatus,
  Prisma,
  StockCondition,
  StockMovementDirection,
  type IssueRequest
} from "@prisma/client";
import { z } from "zod";
import { recordAudit } from "./audit.js";
import { prisma } from "./prisma.js";

export const adminEditIssueSchema = z.object({
  reason: z.string().min(3).max(2000),
  responsibleName: z.string().max(160).optional().nullable(),
  actualRecipientName: z.string().max(160).optional().nullable(),
  items: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        materialId: z.string().min(1),
        quantity: z.number().positive(),
        factLabel: z.string().max(500).optional().nullable(),
        limitNodeId: z.string().min(1).optional().nullable()
      })
    )
    .min(1)
    .optional()
});

export type AdminEditIssueInput = z.infer<typeof adminEditIssueSchema>;

type Tx = Prisma.TransactionClient;

const BLOCKED_STATUSES: IssueRequestStatus[] = [
  IssueRequestStatus.CANCELLED,
  IssueRequestStatus.REJECTED
];

async function applyStockDelta(
  tx: Tx,
  issue: IssueRequest,
  materialId: string,
  limitNodeId: string | null,
  delta: number,
  operationId: string | null,
  actorUserId: string
) {
  if (Math.abs(delta) < 1e-9) return;

  const stock = await tx.stock.findUnique({
    where: {
      warehouseId_materialId_section_condition: {
        warehouseId: issue.warehouseId,
        materialId,
        section: issue.section,
        condition: StockCondition.NEW
      }
    }
  });

  if (delta > 0) {
    const available = stock ? Number(stock.quantity) - Number(stock.reserved) : 0;
    if (!stock || available < delta - 1e-9) {
      throw new Error(`INSUFFICIENT_STOCK:${materialId}`);
    }
    await tx.stock.update({
      where: {
        warehouseId_materialId_section_condition: {
          warehouseId: issue.warehouseId,
          materialId,
          section: issue.section,
          condition: StockCondition.NEW
        }
      },
      data: { quantity: { decrement: delta } }
    });
  } else {
    const returnQty = -delta;
    if (stock) {
      await tx.stock.update({
        where: {
          warehouseId_materialId_section_condition: {
            warehouseId: issue.warehouseId,
            materialId,
            section: issue.section,
            condition: StockCondition.NEW
          }
        },
        data: { quantity: { increment: returnQty } }
      });
    } else {
      await tx.stock.create({
        data: {
          warehouseId: issue.warehouseId,
          materialId,
          section: issue.section,
          condition: StockCondition.NEW,
          quantity: returnQty
        }
      });
    }
  }

  if (limitNodeId) {
    await tx.objectLimitNode.update({
      where: { id: limitNodeId },
      data: {
        issuedQty: delta > 0 ? { increment: delta } : { decrement: -delta }
      }
    });
  }

  if (issue.projectId) {
    const latestLimit = await tx.projectLimit.findFirst({
      where: { projectId: issue.projectId },
      orderBy: { version: "desc" }
    });
    if (latestLimit) {
      await tx.projectLimitItem.updateMany({
        where: { projectLimitId: latestLimit.id, materialId },
        data: {
          issuedQty: delta > 0 ? { increment: delta } : { decrement: -delta }
        }
      });
    }
  }

  await tx.stockMovement.create({
    data: {
      warehouseId: issue.warehouseId,
      materialId,
      quantity: Math.abs(delta),
      direction: delta > 0 ? StockMovementDirection.OUT : StockMovementDirection.IN,
      sourceDocumentType: "ISSUE_ADMIN_EDIT",
      sourceDocumentId: issue.id,
      operationId: operationId ?? undefined,
      issueRequestId: issue.id,
      createdById: actorUserId
    }
  });
}

async function replaceDraftItems(
  tx: Tx,
  issueRequestId: string,
  items: NonNullable<AdminEditIssueInput["items"]>
) {
  await tx.issueRequestItem.deleteMany({ where: { issueRequestId } });
  for (const item of items) {
    await tx.issueRequestItem.create({
      data: {
        issueRequestId,
        materialId: item.materialId,
        quantity: item.quantity,
        factLabel: item.factLabel?.trim() || null,
        limitNodeId: item.limitNodeId || null
      }
    });
  }
}

async function syncOperationItems(tx: Tx, issueRequestId: string) {
  const operation = await tx.operation.findFirst({
    where: { issueRequestId },
    select: { id: true }
  });
  if (!operation) return null;

  const lines = await tx.issueRequestItem.findMany({ where: { issueRequestId } });
  await tx.operationItem.deleteMany({ where: { operationId: operation.id } });
  if (lines.length) {
    await tx.operationItem.createMany({
      data: lines.map((line) => ({
        operationId: operation.id,
        materialId: line.materialId,
        quantity: line.quantity
      }))
    });
  }
  return operation.id;
}

async function applyIssuedMaterialItemsEdit(
  tx: Tx,
  issue: IssueRequest & { items: Array<{ id: string; materialId: string; quantity: Prisma.Decimal; limitNodeId: string | null; factLabel: string | null }> },
  newItems: NonNullable<AdminEditIssueInput["items"]>,
  actorUserId: string
) {
  const operation = await tx.operation.findFirst({
    where: { issueRequestId: issue.id },
    select: { id: true }
  });
  const operationId = operation?.id ?? null;

  const oldById = new Map(issue.items.map((row) => [row.id, row]));
  const keptIds = new Set<string>();

  for (const row of newItems) {
    if (row.id && oldById.has(row.id)) {
      keptIds.add(row.id);
      const prev = oldById.get(row.id)!;
      const prevQty = Number(prev.quantity);
      const nextQty = row.quantity;

      if (prev.materialId !== row.materialId) {
        throw new Error(`MATERIAL_CHANGE_NOT_ALLOWED:${row.id}`);
      }

      const delta = nextQty - prevQty;
      await applyStockDelta(
        tx,
        issue,
        prev.materialId,
        row.limitNodeId ?? prev.limitNodeId,
        delta,
        operationId,
        actorUserId
      );

      await tx.issueRequestItem.update({
        where: { id: row.id },
        data: {
          quantity: nextQty,
          factLabel: row.factLabel?.trim() || null,
          limitNodeId: row.limitNodeId ?? prev.limitNodeId
        }
      });
      continue;
    }

    await applyStockDelta(
      tx,
      issue,
      row.materialId,
      row.limitNodeId ?? null,
      row.quantity,
      operationId,
      actorUserId
    );
    await tx.issueRequestItem.create({
      data: {
        issueRequestId: issue.id,
        materialId: row.materialId,
        quantity: row.quantity,
        factLabel: row.factLabel?.trim() || null,
        limitNodeId: row.limitNodeId || null
      }
    });
  }

  for (const prev of issue.items) {
    if (keptIds.has(prev.id)) continue;
    const qty = Number(prev.quantity);
    await applyStockDelta(tx, issue, prev.materialId, prev.limitNodeId, -qty, operationId, actorUserId);
    await tx.issueRequestItem.delete({ where: { id: prev.id } });
  }

  await syncOperationItems(tx, issue.id);
}

export async function adminEditIssueRequest(params: {
  issueId: string;
  actorUserId: string;
  input: AdminEditIssueInput;
}) {
  const issue = await prisma.issueRequest.findUnique({
    where: { id: params.issueId },
    include: {
      items: true,
      toolItems: { include: { tool: true } }
    }
  });
  if (!issue) {
    return { status: 404 as const, body: { error: "Issue request not found" } };
  }
  if (BLOCKED_STATUSES.includes(issue.status)) {
    return {
      status: 409 as const,
      body: { error: `Нельзя редактировать заявку в статусе ${issue.status}` }
    };
  }

  const { reason, responsibleName, actualRecipientName, items } = params.input;
  const beforeSnapshot = {
    status: issue.status,
    responsibleName: issue.responsibleName,
    actualRecipientName: issue.actualRecipientName,
    items: issue.items.map((x) => ({
      id: x.id,
      materialId: x.materialId,
      quantity: Number(x.quantity),
      factLabel: x.factLabel,
      limitNodeId: x.limitNodeId
    })),
    tools: issue.toolItems.map((x) => x.toolId)
  };

  try {
    await prisma.$transaction(async (tx) => {
      const headerPatch: Prisma.IssueRequestUpdateInput = {};
      if (responsibleName !== undefined) headerPatch.responsibleName = responsibleName?.trim() || null;
      if (actualRecipientName !== undefined) {
        headerPatch.actualRecipientName = actualRecipientName?.trim() || null;
      }
      if (Object.keys(headerPatch).length) {
        await tx.issueRequest.update({ where: { id: issue.id }, data: headerPatch });
      }

      if (issue.domain === IssueRequestDomain.TOOLS) {
        const recipient =
          (actualRecipientName !== undefined ? actualRecipientName : issue.actualRecipientName)?.trim() ||
          (responsibleName !== undefined ? responsibleName : issue.responsibleName)?.trim() ||
          "";
        if (recipient && issue.status === IssueRequestStatus.ISSUED) {
          for (const line of issue.toolItems) {
            await tx.tool.update({
              where: { id: line.toolId },
              data: { responsible: recipient }
            });
          }
        }
        return;
      }

      if (!items) return;

      if (issue.status === IssueRequestStatus.ISSUED) {
        await applyIssuedMaterialItemsEdit(tx, issue, items, params.actorUserId);
      } else {
        await replaceDraftItems(tx, issue.id, items);
        await syncOperationItems(tx, issue.id);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      return {
        status: 409 as const,
        body: { error: "Недостаточно остатка на складе для увеличения выдачи" }
      };
    }
    if (error instanceof Error && error.message.startsWith("MATERIAL_CHANGE_NOT_ALLOWED:")) {
      return {
        status: 400 as const,
        body: { error: "Нельзя менять номенклатуру существующей строки — удалите строку и добавьте новую" }
      };
    }
    throw error;
  }

  const updated = await prisma.issueRequest.findUnique({
    where: { id: issue.id },
    include: {
      items: { include: { material: true } },
      toolItems: { include: { tool: true } },
      warehouse: true,
      project: true,
      requestedBy: true,
      approvedBy: true
    }
  });

  await recordAudit({
    userId: params.actorUserId,
    action: "ISSUE_REQUEST_ADMIN_EDIT",
    entityType: "IssueRequest",
    entityId: issue.id,
    summary: `Админ-правка выдачи ${issue.number}. Причина: ${reason.trim()}`,
    before: beforeSnapshot,
    after: {
      responsibleName: updated?.responsibleName ?? null,
      actualRecipientName: updated?.actualRecipientName ?? null,
      items: updated?.items.map((x) => ({
        id: x.id,
        materialId: x.materialId,
        quantity: Number(x.quantity),
        factLabel: x.factLabel,
        limitNodeId: x.limitNodeId
      })),
      reason: reason.trim()
    }
  });

  return { status: 200 as const, body: updated };
}
