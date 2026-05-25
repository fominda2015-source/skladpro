import { NotificationLevel } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { NOTIFICATION_EVENTS, isKnownEventCode } from "../lib/notificationEvents.js";
import { getLowStockThreshold, setLowStockThreshold } from "../lib/notifications.js";
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
