import { Prisma, CampItemCategory, CampItemStatus, ObjectSection } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(requireAuth);
auditRouter.use(requirePermission("audit.read"));

const ENTITY_LABELS: Record<string, string> = {
  User: "Пользователь",
  Warehouse: "Объект",
  Project: "Проект",
  ProjectLimit: "Лимит",
  Operation: "Операция",
  IssueRequest: "Выдача",
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
  CAMP_ITEM_DELETE: "Удалена позиция городка"
};

const REVERTABLE_ACTIONS = new Set<string>([
  "CAMP_ITEM_CREATE",
  "CAMP_ITEM_UPDATE",
  "CAMP_ITEM_DELETE"
]);

function isRevertable(action: string): boolean {
  return REVERTABLE_ACTIONS.has(action);
}

function formatRow(row: any) {
  return {
    ...row,
    actionLabel: ACTION_LABELS[row.action] || row.action,
    entityLabel: ENTITY_LABELS[row.entityType] || row.entityType,
    revertable: isRevertable(row.action) && !row.reverted
  };
}

auditRouter.get("/", async (req, res) => {
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
auditRouter.get("/meta", async (_req, res) => {
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
    default:
      return { ok: false, error: "Откат этого типа действия пока не поддерживается" };
  }
}

auditRouter.post(
  "/:id/revert",
  requirePermission("audit.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: { user: true }
    });
    if (!log) return res.status(404).json({ error: "Запись не найдена" });
    if (log.reverted) return res.status(400).json({ error: "Эта запись уже отменена" });
    if (!isRevertable(log.action)) {
      return res.status(400).json({ error: "Откат этого типа действия не поддерживается" });
    }
    const result = await revertAction(log);
    if (!result.ok) return res.status(400).json({ error: result.error });

    const updated = await prisma.auditLog.update({
      where: { id },
      data: {
        reverted: true,
        revertedAt: new Date(),
        revertedById: req.user!.userId
      },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        revertedBy: { select: { id: true, email: true, fullName: true } }
      }
    });
    return res.json(formatRow(updated));
  }
);
