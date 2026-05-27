import { NotificationLevel } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { NOTIFICATION_EVENTS, isKnownEventCode } from "../lib/notificationEvents.js";
import { getLowStockThreshold, notifyUser, setLowStockThreshold } from "../lib/notifications.js";
import {
  getCriticalRecipientUserIds,
  listUsersOnWarehouse,
  setCriticalRecipientUserIds
} from "../lib/criticalRecipients.js";
import { getRequestDataScope } from "../lib/dataScope.js";
import { withRepairedFileName } from "../lib/uploadFileName.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1)
});

const ruleBulkSchema = z.object({
  // Запись правила: на пользователя — список включённых событий и уровни.
  items: z
    .array(
      z.object({
        userId: z.string().min(1),
        eventCode: z.string().min(1),
        enabled: z.boolean(),
        level: z.nativeEnum(NotificationLevel).nullable().optional()
      })
    )
    .min(1)
});

const lowStockSchema = z.object({ value: z.coerce.number().min(0).max(1_000_000) });

const criticalRecipientsSchema = z.object({
  warehouseId: z.string().min(1),
  userIds: z.array(z.string().min(1))
});

function canManageRules(req: AuthedRequest): boolean {
  const perms = Array.isArray(req.user?.permissions) ? req.user!.permissions : [];
  if (req.user?.role === "ADMIN") return true;
  return perms.includes("notifications.rules.manage") || perms.includes("admin.users.manage");
}

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// Открытый для всех читателей уведомлений — каталог событий (полезен в UI).
notificationsRouter.get("/events", (_req, res) => {
  return res.json(NOTIFICATION_EVENTS);
});

// Универсальный порог низкого остатка.
notificationsRouter.get("/settings/low-stock", async (_req, res) => {
  const value = await getLowStockThreshold();
  return res.json({ value });
});

notificationsRouter.patch("/settings/low-stock", async (req: AuthedRequest, res) => {
  if (!canManageRules(req)) return res.status(403).json({ error: "Недостаточно прав" });
  const parsed = lowStockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  await setLowStockThreshold(parsed.data.value);
  return res.json({ value: Math.floor(parsed.data.value) });
});

notificationsRouter.get("/settings/critical-recipients/warehouses", async (req: AuthedRequest, res) => {
  if (!canManageRules(req)) return res.status(403).json({ error: "Недостаточно прав" });
  const scope = await getRequestDataScope(req);
  const rows = await prisma.warehouse.findMany({
    where:
      scope.unrestricted || !scope.warehouseIds?.length
        ? {}
        : { id: { in: scope.warehouseIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });
  return res.json(rows);
});

notificationsRouter.get("/settings/critical-recipients/warehouse-users", async (req: AuthedRequest, res) => {
  if (!canManageRules(req)) return res.status(403).json({ error: "Недостаточно прав" });
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : "";
  if (!warehouseId) return res.status(400).json({ error: "warehouseId обязателен" });
  const rows = await listUsersOnWarehouse(warehouseId);
  return res.json(
    rows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role.name,
      position: u.position?.name || null
    }))
  );
});

notificationsRouter.get("/settings/critical-recipients", async (req: AuthedRequest, res) => {
  if (!canManageRules(req)) return res.status(403).json({ error: "Недостаточно прав" });
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : "";
  if (!warehouseId) return res.status(400).json({ error: "warehouseId обязателен" });
  const userIds = await getCriticalRecipientUserIds(warehouseId);
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, email: true },
          orderBy: { fullName: "asc" }
        })
      : [];
  return res.json({ warehouseId, userIds, users });
});

notificationsRouter.put("/settings/critical-recipients", async (req: AuthedRequest, res) => {
  if (!canManageRules(req)) return res.status(403).json({ error: "Недостаточно прав" });
  const parsed = criticalRecipientsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const { warehouseId, userIds } = parsed.data;
  const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } });
  if (!wh) return res.status(404).json({ error: "Объект не найден" });

  const prev = new Set(await getCriticalRecipientUserIds(warehouseId));
  const next = await setCriticalRecipientUserIds(warehouseId, userIds);
  const added = next.filter((id) => !prev.has(id));
  for (const userId of added) {
    await notifyUser({
      userId,
      title: "Критические уведомления",
      message: `Вас назначили получателем критических уведомлений по объекту «${wh.name}». Дубликаты — в чате от «Помощник».`,
      level: NotificationLevel.INFO,
      eventCode: "CRITICAL_RECIPIENT_ASSIGNED",
      entityType: "Warehouse",
      entityId: warehouseId
    }).catch(() => undefined);
  }
  const users =
    next.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: next } },
          select: { id: true, fullName: true, email: true },
          orderBy: { fullName: "asc" }
        })
      : [];
  return res.json({ warehouseId, userIds: next, users, addedCount: added.length });
});

// Правила: список для UI настройки. Доступно тому, кто может ими управлять.
notificationsRouter.get("/rules", async (req: AuthedRequest, res) => {
  if (!canManageRules(req)) return res.status(403).json({ error: "Недостаточно прав" });
  const userIdFilter = typeof req.query.userId === "string" ? req.query.userId : "";
  const rows = await prisma.notificationRule.findMany({
    where: userIdFilter ? { userId: userIdFilter } : {},
    include: { user: { select: { id: true, fullName: true, email: true } } },
    orderBy: [{ userId: "asc" }, { eventCode: "asc" }]
  });
  return res.json(rows);
});

notificationsRouter.put("/rules", async (req: AuthedRequest, res) => {
  if (!canManageRules(req)) return res.status(403).json({ error: "Недостаточно прав" });
  const parsed = ruleBulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  for (const item of parsed.data.items) {
    if (!isKnownEventCode(item.eventCode)) {
      return res.status(400).json({ error: `Неизвестное событие: ${item.eventCode}` });
    }
    await prisma.notificationRule.upsert({
      where: { userId_eventCode: { userId: item.userId, eventCode: item.eventCode } },
      create: {
        userId: item.userId,
        eventCode: item.eventCode,
        enabled: item.enabled,
        level: item.level ?? null
      },
      update: {
        enabled: item.enabled,
        level: item.level ?? null
      }
    });
  }
  return res.json({ ok: true, count: parsed.data.items.length });
});

notificationsRouter.use(requirePermission("notifications.read"));

notificationsRouter.get("/", async (req: AuthedRequest, res) => {
  const unreadOnly = req.query.unreadOnly === "1";
  const rows = await prisma.notification.findMany({
    where: {
      userId: req.user!.userId,
      ...(unreadOnly ? { isRead: false } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

const ACTION_LABELS: Record<string, string> = {
  ISSUE_REQUEST_APPROVE: "Заявка согласована",
  ISSUE_REQUEST_REJECT: "Заявка отклонена",
  ISSUE_REQUEST_CANCEL: "Заявка отменена",
  ISSUE_REQUEST_ISSUE: "Выдача по заявке",
  ISSUE_REQUEST_DELETE: "Заявка на выдачу удалена",
  RECEIPT_REQUEST_ACCEPT: "Приёмка по заявке",
  RECEIPT_REQUEST_CANCEL: "Заявка на приход отменена",
  RECEIPT_REQUEST_DELETE: "Заявка на приход удалена",
  TOOL_ISSUE: "Инструмент выдан",
  TOOL_RETURN: "Инструмент возвращён"
};

function normalizeEntityKey(entityType: string | null | undefined): string {
  return String(entityType || "")
    .replace(/\s/g, "")
    .toLowerCase();
}

function mapNotificationEntityToAudit(entityType: string | null | undefined): string | undefined {
  if (!entityType) return undefined;
  const key = normalizeEntityKey(entityType);
  if (key.includes("issuerequest") || key === "issue") return "IssueRequest";
  if (key.includes("receiptrequest") || key === "receipt") return "ReceiptRequest";
  if (key.includes("tool")) return "Tool";
  if (key.includes("waybill") || key.includes("transport")) return "TransportWaybill";
  if (key.includes("transfer")) return "TransferRequest";
  if (key === "operation") return "Operation";
  return entityType;
}

function mapNotificationEntityToDocument(entityType: string | null | undefined): string | null {
  if (!entityType) return null;
  const key = normalizeEntityKey(entityType);
  if (key.includes("issue")) return "issue";
  if (key.includes("receipt")) return "receipt";
  if (key === "operation") return "operation";
  return null;
}

async function loadDocumentsForEntity(entityType: string, entityId: string) {
  return prisma.documentFile.findMany({
    where: {
      isDeleted: false,
      OR: [
        { entityType, entityId },
        { links: { some: { entityType, entityId } } }
      ]
    },
    orderBy: { createdAt: "asc" },
    take: 50
  });
}

notificationsRouter.get("/:id/detail", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const notification = await prisma.notification.findFirst({
    where: { id, userId: req.user!.userId }
  });
  if (!notification) {
    return res.status(404).json({ error: "Уведомление не найдено" });
  }

  const auditEntityType = mapNotificationEntityToAudit(notification.entityType);
  const auditLogs = notification.entityId
    ? await prisma.auditLog.findMany({
        where: auditEntityType
          ? { entityId: notification.entityId, entityType: auditEntityType }
          : { entityId: notification.entityId },
        include: {
          user: { select: { id: true, email: true, fullName: true } }
        },
        orderBy: { createdAt: "asc" },
        take: 30
      })
    : [];

  type DocRow = Awaited<ReturnType<typeof loadDocumentsForEntity>>[number];
  const docMap = new Map<string, DocRow>();
  const docEntity = mapNotificationEntityToDocument(notification.entityType);
  if (notification.entityId && docEntity) {
    for (const d of await loadDocumentsForEntity(docEntity, notification.entityId)) {
      docMap.set(d.id, d);
    }
  }
  for (const log of auditLogs) {
    const after = log.afterData as { operationId?: string } | null;
    const opId = after?.operationId;
    if (opId) {
      for (const d of await loadDocumentsForEntity("operation", opId)) {
        docMap.set(d.id, d);
      }
    }
  }

  const eventLabel = notification.eventCode
    ? NOTIFICATION_EVENTS.find((e) => e.code === notification.eventCode)?.label
    : undefined;

  return res.json({
    notification,
    eventLabel,
    auditLogs: auditLogs.map((row) => ({
      id: row.id,
      action: row.action,
      actionLabel: ACTION_LABELS[row.action] || row.action,
      summary: row.summary,
      createdAt: row.createdAt,
      user: row.user,
      beforeData: row.beforeData,
      afterData: row.afterData
    })),
    documents: Array.from(docMap.values())
      .map((d) => withRepairedFileName(d))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  });
});

notificationsRouter.patch("/read", requirePermission("notifications.write"), async (req: AuthedRequest, res) => {
  const parsed = markReadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  await prisma.notification.updateMany({
    where: {
      id: { in: parsed.data.ids },
      userId: req.user!.userId
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });

  return res.json({ ok: true });
});
