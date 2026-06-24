import {
  Prisma,
  CampItemCategory,
  CampItemStatus,
  IssueRequestStatus,
  ObjectSection,
  StockCondition,
  StockMovementDirection,
  ToolStatus
} from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { isReceiptFullyAccepted, receiptAcceptedQty } from "../lib/receiptQty.js";
import { requireAdminRole, requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(requireAuth);
auditRouter.use(requireAdminRole);

const ENTITY_LABELS: Record<string, string> = {
  User: "Пользователь",
  Warehouse: "Объект",
  Project: "Проект",
  ProjectLimit: "Лимит",
  Operation: "Операция",
  IssueRequest: "Выдача",
  ReceiptRequest: "Заявка",
  Tool: "Инструмент",
  Material: "Материал",
  CampItem: "Городок"
};

const ACTION_LABELS: Record<string, string> = {
  USER_SCOPES_SET: "Изменены области доступа пользователя",
  OBJECT_CREATE: "Создан объект",
  OBJECT_USERS_ADD: "Добавлены пользователи в объект",
  OBJECT_USERS_SYNC: "Обновлен список пользователей объекта",
  OBJECT_SECTION_USERS_SYNC: "Обновлены доступы по разделу объекта",
  OPERATION_CREATE: "Создана операция",
  TOOL_CREATE: "Создан инструмент",
  TOOL_ISSUE: "Инструмент выдан",
  TOOL_RETURN: "Инструмент возвращен",
  TOOL_SEND_TO_REPAIR: "Инструмент отправлен в ремонт",
  TOOL_MARK_DAMAGED: "Инструмент помечен поврежденным",
  TOOL_MARK_LOST: "Инструмент помечен утерянным",
  TOOL_MARK_DISPUTED: "Инструмент помечен спорным",
  TOOL_WRITE_OFF: "Инструмент списан",
  CAMP_ITEM_CREATE: "Добавлена позиция городка",
  CAMP_ITEM_UPDATE: "Изменена позиция городка",
  CAMP_ITEM_DELETE: "Удалена позиция городка",
  ISSUE_REQUEST_APPROVE: "Заявка согласована",
  ISSUE_REQUEST_REJECT: "Заявка отклонена",
  ISSUE_REQUEST_CANCEL: "Заявка отменена",
  ISSUE_REQUEST_ISSUE: "Выдача по заявке",
  ISSUE_REQUEST_DELETE: "Заявка на выдачу удалена",
  RECEIPT_REQUEST_ACCEPT: "Приёмка по заявке",
  RECEIPT_REQUEST_CANCEL: "Заявка на приход отменена",
  RECEIPT_REQUEST_DELETE: "Заявка на приход удалена"
};

const REVERTABLE_ACTIONS = new Set<string>([
  "CAMP_ITEM_CREATE",
  "CAMP_ITEM_UPDATE",
  "CAMP_ITEM_DELETE",
  "OPERATION_CREATE",
  "TOOL_CREATE",
  "TOOL_ISSUE",
  "TOOL_RETURN",
  "TOOL_SEND_TO_REPAIR",
  "TOOL_MARK_DAMAGED",
  "TOOL_MARK_LOST",
  "TOOL_MARK_DISPUTED",
  "TOOL_WRITE_OFF",
  "OBJECT_CREATE",
  "OBJECT_USERS_ADD",
  "OBJECT_USERS_SYNC",
  "OBJECT_SECTION_USERS_SYNC",
  "USER_SCOPES_SET",
  "ISSUE_REQUEST_APPROVE",
  "ISSUE_REQUEST_REJECT",
  "ISSUE_REQUEST_CANCEL",
  "ISSUE_REQUEST_ISSUE",
  "RECEIPT_REQUEST_ACCEPT"
]);

function isRevertable(action: string): boolean {
  return REVERTABLE_ACTIONS.has(action);
}

function formatRow(row: any) {
  return {
    ...row,
    actionLabel: ACTION_LABELS[row.action] || row.action,
    entityLabel: ENTITY_LABELS[row.entityType] || row.entityType,
    revertable: isRevertable(row.action) && !row.reverted,
    // Любую запись лога админ может пометить отменённой вручную (мягкий revert).
    canSoftRevert: !row.reverted
  };
}

auditRouter.get("/", async (req: AuthedRequest, res) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
  const showReverted = req.query.showReverted === "1" || req.query.showReverted === "true";
  const take = Math.min(Number(req.query.take) || 200, 1000);

  const where: Prisma.AuditLogWhereInput = {
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(userId ? { userId } : {}),
    ...(action ? { action } : {}),
    ...(showReverted ? {} : { reverted: false })
  };

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(dateTo);
  }

  if (q) {
    where.OR = [
      { summary: { contains: q, mode: "insensitive" } },
      { entityId: { contains: q, mode: "insensitive" } },
      { entityType: { contains: q, mode: "insensitive" } },
      { action: { contains: q, mode: "insensitive" } },
      { user: { is: { fullName: { contains: q, mode: "insensitive" } } } },
      { user: { is: { email: { contains: q, mode: "insensitive" } } } }
    ];
  }

  const rows = await prisma.auditLog.findMany({
    where,
    include: {
      user: { select: { id: true, email: true, fullName: true } },
      revertedBy: { select: { id: true, email: true, fullName: true } }
    },
    orderBy: { createdAt: "desc" },
    take
  });
  return res.json(rows.map(formatRow));
});

// Метаданные для UI: список пользователей и сущностей для фильтров.
auditRouter.get("/meta", async (_req: AuthedRequest, res) => {
  const [users, entityTypesRaw] = await Promise.all([
    prisma.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: "asc" }
    }),
    prisma.auditLog.groupBy({ by: ["entityType"], _count: { entityType: true } })
  ]);
  const entityTypes = entityTypesRaw
    .map((g) => ({
      entityType: g.entityType,
      label: ENTITY_LABELS[g.entityType] || g.entityType,
      count: g._count.entityType
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  return res.json({ users, entityTypes });
});

type AuditLogRow = Prisma.AuditLogGetPayload<{ include: { user: true } }>;

type RevertResult = { ok: true } | { ok: false; error: string };

async function revertAction(log: AuditLogRow): Promise<RevertResult> {
  switch (log.action) {
    case "CAMP_ITEM_CREATE": {
      const exists = await prisma.campItem.findUnique({ where: { id: log.entityId } });
      if (!exists) return { ok: true };
      await prisma.$transaction(async (tx) => {
        await tx.documentFile.updateMany({
          where: { entityType: "camp", entityId: log.entityId, isDeleted: false },
          data: { isDeleted: true }
        });
        await tx.campItem.delete({ where: { id: log.entityId } });
      });
      return { ok: true };
    }
    case "CAMP_ITEM_UPDATE": {
      const before = log.beforeData as Record<string, unknown> | null;
      if (!before) return { ok: false, error: "Нет данных до изменения" };
      const exists = await prisma.campItem.findUnique({ where: { id: log.entityId } });
      if (!exists) return { ok: false, error: "Позиция уже удалена" };
      await prisma.campItem.update({
        where: { id: log.entityId },
        data: {
          name: String(before.name ?? exists.name),
          category: (before.category as CampItemCategory) ?? exists.category,
          inventoryNumber: (before.inventoryNumber as string | null) ?? null,
          serialNumber: (before.serialNumber as string | null) ?? null,
          manufacturer: (before.manufacturer as string | null) ?? null,
          location: (before.location as string | null) ?? null,
          description: (before.description as string | null) ?? null,
          warehouseId: (before.warehouseId as string | null) ?? null,
          section: (before.section as ObjectSection) ?? exists.section,
          status: (before.status as CampItemStatus) ?? exists.status,
          acquiredAt: before.acquiredAt ? new Date(String(before.acquiredAt)) : null
        }
      });
      return { ok: true };
    }
    case "CAMP_ITEM_DELETE": {
      const before = log.beforeData as Record<string, unknown> | null;
      if (!before || !before.id) return { ok: false, error: "Нет снимка для восстановления" };
      const exists = await prisma.campItem.findUnique({ where: { id: log.entityId } });
      if (exists) return { ok: false, error: "Позиция уже существует" };
      await prisma.campItem.create({
        data: {
          id: String(before.id),
          name: String(before.name ?? "Восстановлено"),
          category: (before.category as CampItemCategory) ?? "OTHER",
          inventoryNumber: (before.inventoryNumber as string | null) ?? null,
          serialNumber: (before.serialNumber as string | null) ?? null,
          manufacturer: (before.manufacturer as string | null) ?? null,
          location: (before.location as string | null) ?? null,
          description: (before.description as string | null) ?? null,
          warehouseId: (before.warehouseId as string | null) ?? null,
          section: (before.section as ObjectSection) ?? "SS",
          status: (before.status as CampItemStatus) ?? "IN_USE",
          acquiredAt: before.acquiredAt ? new Date(String(before.acquiredAt)) : null,
          createdById: (before.createdById as string | null) ?? null
        }
      });
      // Восстановим soft-deleted файлы.
      await prisma.documentFile.updateMany({
        where: { entityType: "camp", entityId: log.entityId, isDeleted: true },
        data: { isDeleted: false }
      });
      return { ok: true };
    }
    case "OPERATION_CREATE": {
      const after = log.afterData as
        | {
            type?: "INCOME" | "EXPENSE";
            warehouseId?: string;
            section?: "SS" | "EOM";
            items?: Array<{ materialId: string; quantity: number }>;
          }
        | null;
      const op = await prisma.operation.findUnique({
        where: { id: log.entityId },
        include: { items: true }
      });
      if (!op) return { ok: false, error: "Операция уже удалена" };
      const type = (after?.type as "INCOME" | "EXPENSE") || (op.type as "INCOME" | "EXPENSE");
      const warehouseId = after?.warehouseId || op.warehouseId;
      const section = (after?.section as ObjectSection) || op.section;
      const items =
        after?.items && after.items.length
          ? after.items
          : op.items.map((i) => ({ materialId: i.materialId, quantity: Number(i.quantity) }));

      try {
        await prisma.$transaction(async (tx) => {
          for (const it of items) {
            const stock = await tx.stock.findUnique({
              where: {
                warehouseId_materialId_section_condition: {
                  warehouseId,
                  materialId: it.materialId,
                  section,
                  condition: StockCondition.NEW
                }
              }
            });
            if (type === "INCOME") {
              if (!stock || Number(stock.quantity) < it.quantity - 1e-6) {
                throw new Error(
                  `INSUFFICIENT_STOCK_FOR_REVERT:${it.materialId}`
                );
              }
              await tx.stock.update({
                where: {
                  warehouseId_materialId_section_condition: {
                    warehouseId,
                    materialId: it.materialId,
                    section,
                    condition: StockCondition.NEW
                  }
                },
                data: { quantity: { decrement: it.quantity } }
              });
            } else if (type === "EXPENSE") {
              if (stock) {
                await tx.stock.update({
                  where: {
                    warehouseId_materialId_section_condition: {
                    warehouseId,
                    materialId: it.materialId,
                    section,
                    condition: StockCondition.NEW
                  }
                  },
                  data: { quantity: { increment: it.quantity } }
                });
              } else {
                await tx.stock.create({
                  data: {
                    warehouseId,
                    materialId: it.materialId,
                    section,
                    condition: StockCondition.NEW,
                    quantity: it.quantity,
                    reserved: 0
                  }
                });
              }
            }
          }
          await tx.stockMovement.deleteMany({ where: { operationId: op.id } });
          await tx.operationItem.deleteMany({ where: { operationId: op.id } });
          await tx.documentFile.updateMany({
            where: { entityType: "operation", entityId: op.id, isDeleted: false },
            data: { isDeleted: true }
          });
          await tx.operation.delete({ where: { id: op.id } });
        });
        return { ok: true };
      } catch (err) {
        const msg = (err as Error).message || "";
        if (msg.startsWith("INSUFFICIENT_STOCK_FOR_REVERT:")) {
          return {
            ok: false,
            error: "Недостаточно остатка для отката прихода — часть уже выдана. Сначала откатите выдачи."
          };
        }
        throw err;
      }
    }
    case "TOOL_CREATE": {
      const tool = await prisma.tool.findUnique({ where: { id: log.entityId } });
      if (!tool) return { ok: true };
      await prisma.$transaction(async (tx) => {
        await tx.toolEvent.deleteMany({ where: { toolId: log.entityId } });
        await tx.tool.delete({ where: { id: log.entityId } });
      });
      return { ok: true };
    }
    case "TOOL_ISSUE":
    case "TOOL_RETURN":
    case "TOOL_SEND_TO_REPAIR":
    case "TOOL_MARK_DAMAGED":
    case "TOOL_MARK_LOST":
    case "TOOL_MARK_DISPUTED":
    case "TOOL_WRITE_OFF": {
      const before = log.beforeData as
        | { status?: ToolStatus; responsible?: string | null }
        | null;
      if (!before || !before.status) {
        return { ok: false, error: "Нет данных до изменения" };
      }
      const tool = await prisma.tool.findUnique({ where: { id: log.entityId } });
      if (!tool) return { ok: false, error: "Инструмент не найден" };
      await prisma.tool.update({
        where: { id: log.entityId },
        data: {
          status: before.status,
          responsible: before.responsible ?? null
        }
      });
      await prisma.toolEvent.create({
        data: {
          toolId: log.entityId,
          action: "REVERT",
          status: before.status,
          comment: `Откат: ${log.action}`
        }
      });
      return { ok: true };
    }
    case "OBJECT_CREATE": {
      const wh = await prisma.warehouse.findUnique({
        where: { id: log.entityId },
        include: {
          _count: {
            select: {
              stocks: true,
              operations: true,
              issues: true,
              tools: true,
              limitTemplates: true,
              receiptRequests: true,
              campItems: true
            }
          }
        }
      });
      if (!wh) return { ok: true };
      const c = wh._count;
      const total =
        c.stocks +
        c.operations +
        c.issues +
        c.tools +
        c.limitTemplates +
        c.receiptRequests +
        c.campItems;
      if (total > 0) {
        return {
          ok: false,
          error: `На объекте уже есть данные (остатки/операции/инструменты и т.п.) — откат отменён. Удалите данные вручную.`
        };
      }
      await prisma.warehouse.delete({ where: { id: log.entityId } });
      return { ok: true };
    }
    case "OBJECT_USERS_ADD": {
      const before = log.beforeData as { addedIds?: string[]; userIds?: string[] } | null;
      const addedIds = Array.isArray(before?.addedIds) ? before!.addedIds : [];
      if (!addedIds.length) {
        return { ok: false, error: "Нет данных о добавленных пользователях" };
      }
      await prisma.userWarehouseScope.deleteMany({
        where: { warehouseId: log.entityId, userId: { in: addedIds } }
      });
      return { ok: true };
    }
    case "OBJECT_USERS_SYNC": {
      const before = log.beforeData as { userIds?: string[] } | null;
      const prevIds = Array.isArray(before?.userIds) ? before!.userIds : null;
      if (!prevIds) return { ok: false, error: "Нет снимка предыдущих пользователей" };
      await prisma.$transaction(async (tx) => {
        await tx.userWarehouseScope.deleteMany({ where: { warehouseId: log.entityId } });
        if (prevIds.length) {
          await tx.userWarehouseScope.createMany({
            data: prevIds.map((userId) => ({ userId, warehouseId: log.entityId })),
            skipDuplicates: true
          });
        }
      });
      return { ok: true };
    }
    case "OBJECT_SECTION_USERS_SYNC": {
      const before = log.beforeData as { section?: ObjectSection; userIds?: string[] } | null;
      if (!before || !before.section || !Array.isArray(before.userIds)) {
        return { ok: false, error: "Нет снимка предыдущих доступов по разделу" };
      }
      const section = before.section;
      const prevIds = before.userIds;
      await prisma.$transaction(async (tx) => {
        await tx.userWarehouseSectionScope.deleteMany({
          where: { warehouseId: log.entityId, section }
        });
        if (prevIds.length) {
          await tx.userWarehouseSectionScope.createMany({
            data: prevIds.map((userId) => ({ userId, warehouseId: log.entityId, section })),
            skipDuplicates: true
          });
        }
      });
      return { ok: true };
    }
    case "USER_SCOPES_SET": {
      const before = log.beforeData as
        | {
            warehouseIds?: string[];
            projectIds?: string[];
            sectionScopes?: Array<{ warehouseId: string; section: ObjectSection }>;
          }
        | null;
      if (!before) return { ok: false, error: "Нет данных до изменения" };
      const userId = log.entityId;
      const whIds = Array.isArray(before.warehouseIds) ? before.warehouseIds : [];
      const pjIds = Array.isArray(before.projectIds) ? before.projectIds : [];
      const secScopes = Array.isArray(before.sectionScopes) ? before.sectionScopes : [];
      await prisma.$transaction(async (tx) => {
        await tx.userWarehouseScope.deleteMany({ where: { userId } });
        await tx.userProjectScope.deleteMany({ where: { userId } });
        await tx.userWarehouseSectionScope.deleteMany({ where: { userId } });
        if (whIds.length) {
          await tx.userWarehouseScope.createMany({
            data: whIds.map((warehouseId) => ({ userId, warehouseId })),
            skipDuplicates: true
          });
        }
        if (pjIds.length) {
          await tx.userProjectScope.createMany({
            data: pjIds.map((projectId) => ({ userId, projectId })),
            skipDuplicates: true
          });
        }
        if (secScopes.length) {
          await tx.userWarehouseSectionScope.createMany({
            data: secScopes
              .filter((s) => s && s.warehouseId && s.section)
              .map((s) => ({ userId, warehouseId: s.warehouseId, section: s.section })),
            skipDuplicates: true
          });
        }
      });
      return { ok: true };
    }
    case "ISSUE_REQUEST_APPROVE":
    case "ISSUE_REQUEST_REJECT":
    case "ISSUE_REQUEST_CANCEL": {
      const before = log.beforeData as
        | { status?: IssueRequestStatus; approvedById?: string | null }
        | null;
      if (!before || !before.status) {
        return { ok: false, error: "Нет данных до изменения" };
      }
      const exists = await prisma.issueRequest.findUnique({ where: { id: log.entityId } });
      if (!exists) return { ok: false, error: "Заявка не найдена" };
      if (exists.status === IssueRequestStatus.ISSUED) {
        return { ok: false, error: "Заявка уже проведена. Сначала откатите выдачу." };
      }
      await prisma.issueRequest.update({
        where: { id: log.entityId },
        data: {
          status: before.status,
          approvedById: before.approvedById ?? null
        }
      });
      return { ok: true };
    }
    case "ISSUE_REQUEST_ISSUE": {
      const after = log.afterData as
        | {
            operationId?: string;
            warehouseId?: string;
            section?: ObjectSection;
            projectId?: string | null;
            items?: Array<{ materialId: string; quantity: number }>;
            documentId?: string | null;
          }
        | null;
      const before = log.beforeData as { status?: IssueRequestStatus } | null;
      if (!after?.operationId) {
        return { ok: false, error: "Нет данных операции для отката" };
      }
      const operationId = after.operationId;
      const items = Array.isArray(after.items) ? after.items : [];
      const issueId = log.entityId;
      const op = await prisma.operation.findUnique({
        where: { id: operationId },
        include: { items: true }
      });
      if (!op) {
        // Операция уже удалена — попробуем откатить статус заявки и зафиксировать
        const issue = await prisma.issueRequest.findUnique({ where: { id: issueId } });
        if (issue) {
          await prisma.issueRequest.update({
            where: { id: issueId },
            data: {
              status: before?.status ?? IssueRequestStatus.APPROVED,
              actualRecipientName: null
            }
          });
        }
        return { ok: true };
      }
      const warehouseId = after.warehouseId || op.warehouseId;
      const section = (after.section as ObjectSection) || op.section;
      const finalItems = items.length
        ? items
        : op.items.map((i) => ({ materialId: i.materialId, quantity: Number(i.quantity) }));

      const issueWithItems = await prisma.issueRequest.findUnique({
        where: { id: issueId },
        select: {
          items: { select: { materialId: true, quantity: true, limitNodeId: true } }
        }
      });

      await prisma.$transaction(async (tx) => {
        if (issueWithItems?.items.length) {
          for (const line of issueWithItems.items) {
            if (line.limitNodeId) {
              await tx.objectLimitNode.update({
                where: { id: line.limitNodeId },
                data: { issuedQty: { decrement: line.quantity } }
              });
            }
          }
        }
        for (const it of finalItems) {
          const stock = await tx.stock.findUnique({
            where: {
              warehouseId_materialId_section_condition: {
                warehouseId,
                materialId: it.materialId,
                section,
                condition: StockCondition.NEW
              }
            }
          });
          if (stock) {
            await tx.stock.update({
              where: {
                warehouseId_materialId_section_condition: {
                  warehouseId,
                  materialId: it.materialId,
                  section,
                  condition: StockCondition.NEW
                }
              },
              data: { quantity: { increment: it.quantity } }
            });
          } else {
            await tx.stock.create({
              data: {
                warehouseId,
                materialId: it.materialId,
                section,
                quantity: it.quantity,
                reserved: 0
              }
            });
          }
          // Уменьшим issuedQty в лимите проекта.
          if (op.projectId) {
            const latestLimit = await tx.projectLimit.findFirst({
              where: { projectId: op.projectId },
              orderBy: { version: "desc" }
            });
            if (latestLimit) {
              await tx.projectLimitItem.updateMany({
                where: { projectLimitId: latestLimit.id, materialId: it.materialId },
                data: { issuedQty: { decrement: it.quantity } }
              });
            }
          }
        }
        await tx.stockMovement.deleteMany({
          where: { OR: [{ operationId }, { issueRequestId: issueId, direction: StockMovementDirection.OUT }] }
        });
        await tx.operationItem.deleteMany({ where: { operationId } });
        await tx.documentFile.updateMany({
          where: { entityType: "operation", entityId: operationId, isDeleted: false },
          data: { isDeleted: true }
        });
        if (after.documentId) {
          await tx.documentFile.updateMany({
            where: { id: after.documentId, isDeleted: false },
            data: { isDeleted: true }
          });
        }
        await tx.operation.delete({ where: { id: operationId } });
        await tx.issueRequest.update({
          where: { id: issueId },
          data: {
            status: before?.status ?? IssueRequestStatus.APPROVED,
            actualRecipientName: null
          }
        });
      });
      return { ok: true };
    }
    case "RECEIPT_REQUEST_ACCEPT": {
      const after = log.afterData as
        | {
            operationId?: string;
            warehouseId?: string;
            section?: ObjectSection;
            items?: Array<{
              materialId: string;
              quantity: number;
              receiptRequestItemId?: string;
            }>;
          }
        | null;
      if (!after?.operationId || !Array.isArray(after.items)) {
        return { ok: false, error: "Нет данных о приёмке" };
      }
      const operationId = after.operationId;
      const warehouseId = after.warehouseId!;
      const section = after.section as ObjectSection;
      const requestId = log.entityId;

      try {
        await prisma.$transaction(async (tx) => {
          for (const it of after.items!) {
            const stock = await tx.stock.findUnique({
              where: {
                warehouseId_materialId_section_condition: {
                  warehouseId,
                  materialId: it.materialId,
                  section,
                  condition: StockCondition.NEW
                }
              }
            });
            if (!stock || Number(stock.quantity) < it.quantity - 1e-6) {
              throw new Error(`INSUFFICIENT_STOCK_FOR_REVERT:${it.materialId}`);
            }
            await tx.stock.update({
              where: {
                warehouseId_materialId_section_condition: {
                  warehouseId,
                  materialId: it.materialId,
                  section,
                  condition: StockCondition.NEW
                }
              },
              data: { quantity: { decrement: it.quantity } }
            });
            if (it.receiptRequestItemId) {
              await tx.receiptRequestItem.update({
                where: { id: it.receiptRequestItemId },
                data: { acceptedQty: { decrement: it.quantity } }
              });
            }
          }
          await tx.stockMovement.deleteMany({ where: { operationId } });
          await tx.operationItem.deleteMany({ where: { operationId } });
          await tx.documentFile.updateMany({
            where: { entityType: "operation", entityId: operationId, isDeleted: false },
            data: { isDeleted: true }
          });
          await tx.operation.delete({ where: { id: operationId } });

          // Пересчёт статуса заявки.
          const fresh = await tx.receiptRequest.findUnique({
            where: { id: requestId },
            include: { items: true }
          });
          const anyAccepted = (fresh?.items ?? []).some((it) => receiptAcceptedQty(it.acceptedQty) > 0);
          const allDone = isReceiptFullyAccepted(fresh?.items ?? []);
          await tx.receiptRequest.update({
            where: { id: requestId },
            data: {
              status: allDone ? "RECEIVED" : anyAccepted ? "IN_PROGRESS" : "NEW",
              acceptedAt: allDone ? new Date() : null
            }
          });
        });
        return { ok: true };
      } catch (err) {
        const msg = (err as Error).message || "";
        if (msg.startsWith("INSUFFICIENT_STOCK_FOR_REVERT:")) {
          return {
            ok: false,
            error: "Недостаточно остатка для отката — часть принятого уже выдана. Сначала откатите выдачи."
          };
        }
        throw err;
      }
    }
    default:
      return { ok: false, error: "Откат этого типа действия пока не поддерживается" };
  }
}

auditRouter.post(
  "/:id/revert",
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: { user: true }
    });
    if (!log) return res.status(404).json({ error: "Запись не найдена" });
    if (log.reverted) return res.status(400).json({ error: "Эта запись уже отменена" });

    // `?force=1` — мягкая отмена: помечаем запись лога как отменённую без бизнес-эффекта.
    // Используется админом для логов, которые нельзя откатить автоматически, либо когда
    // бизнес-откат отказался (например, остаток уже использован). Доступно только ADMIN.
    const force =
      String(req.query.force ?? "").toLowerCase() === "1" ||
      String(req.query.force ?? "").toLowerCase() === "true" ||
      (req.body && (req.body as { force?: unknown }).force === true);

    const supportsHard = isRevertable(log.action);
    if (!supportsHard && !force) {
      return res
        .status(400)
        .json({ error: "Откат этого типа действия не поддерживается", canForce: true });
    }

    let softNote: string | undefined;
    if (supportsHard) {
      const result = await revertAction(log);
      if (!result.ok) {
        if (!force) return res.status(400).json({ error: result.error, canForce: true });
        softNote = `Бизнес-откат отказался («${result.error}»), запись закрыта вручную админом.`;
      }
    } else {
      softNote = "Действие отмечено отменённым вручную админом (без бизнес-отката).";
    }

    const updated = await prisma.auditLog.update({
      where: { id },
      data: {
        reverted: true,
        revertedAt: new Date(),
        revertedById: req.user!.userId,
        ...(softNote
          ? {
              afterData: {
                ...((log.afterData as Record<string, unknown> | null) ?? {}),
                __softRevert: { note: softNote, at: new Date().toISOString() }
              }
            }
          : {})
      },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        revertedBy: { select: { id: true, email: true, fullName: true } }
      }
    });
    return res.json({ ...formatRow(updated), softRevert: Boolean(softNote), softNote });
  }
);
