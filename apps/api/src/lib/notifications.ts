import { NotificationLevel } from "@prisma/client";
import { getCriticalRecipientUserIds } from "./criticalRecipients.js";
import { postAssistantChatMessage } from "./assistantChat.js";
import { prisma } from "./prisma.js";
import { NOTIFICATION_EVENTS, type NotificationEventCode } from "./notificationEvents.js";

type NotifyParams = {
  userId: string;
  title: string;
  message: string;
  level?: NotificationLevel;
  entityType?: string;
  entityId?: string;
  eventCode?: string;
};

export async function notifyUser(params: NotifyParams) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      title: params.title,
      message: params.message,
      level: params.level ?? NotificationLevel.INFO,
      entityType: params.entityType,
      entityId: params.entityId,
      eventCode: params.eventCode
    }
  });
}

type DispatchParams = {
  eventCode: NotificationEventCode | string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  // Если передан явный список — рассылаем только им и игнорируем правила.
  forceRecipients?: string[];
  // Кого исключить (обычно — инициатор события).
  excludeUserIds?: string[];
  // Принудительный уровень. Иначе берём из правила или из дефолта события.
  level?: NotificationLevel;
};

// Универсальная шина: ищем подписчиков по eventCode и создаём им уведомления.
// Не падает на отсутствии подписчиков — просто ничего не делает.
export async function dispatchNotification(params: DispatchParams): Promise<number> {
  const defaultLevel =
    NOTIFICATION_EVENTS.find((e) => e.code === params.eventCode)?.defaultLevel ?? NotificationLevel.INFO;
  const recipients = new Set<string>();
  if (params.forceRecipients?.length) {
    for (const id of params.forceRecipients) recipients.add(id);
  } else {
    const rules = await prisma.notificationRule.findMany({
      where: { eventCode: params.eventCode, enabled: true },
      select: { userId: true, level: true }
    });
    for (const r of rules) recipients.add(r.userId);
  }
  if (params.excludeUserIds?.length) {
    for (const id of params.excludeUserIds) recipients.delete(id);
  }
  if (!recipients.size) return 0;
  // Прокатываемся по получателям параллельно и игнорируем ошибки одного.
  const ops = Array.from(recipients).map((userId) =>
    prisma.notification
      .create({
        data: {
          userId,
          title: params.title,
          message: params.message,
          level: params.level ?? defaultLevel,
          entityType: params.entityType,
          entityId: params.entityId,
          eventCode: String(params.eventCode)
        }
      })
      .catch(() => null)
  );
  await Promise.all(ops);
  return recipients.size;
}

async function mirrorNotificationsToAssistant(
  recipientUserIds: string[],
  title: string,
  message: string
): Promise<void> {
  const text = `🔔 ${title}\n\n${message}`;
  for (const userId of recipientUserIds) {
    await postAssistantChatMessage(userId, text).catch(() => undefined);
  }
}

type CriticalDispatchParams = Omit<DispatchParams, "level" | "forceRecipients"> & {
  warehouseId: string;
  forceRecipients?: string[];
};

/** Критические события — получатели, назначенные на объект (склад). */
export async function dispatchCriticalNotification(params: CriticalDispatchParams): Promise<number> {
  const fromSettings = await getCriticalRecipientUserIds(params.warehouseId);
  const recipients = new Set<string>(params.forceRecipients?.length ? params.forceRecipients : fromSettings);
  if (params.excludeUserIds?.length) {
    for (const id of params.excludeUserIds) recipients.delete(id);
  }
  if (!recipients.size) return 0;

  const defaultLevel = NotificationLevel.ERROR;
  const ops = Array.from(recipients).map((userId) =>
    prisma.notification
      .create({
        data: {
          userId,
          title: params.title,
          message: params.message,
          level: defaultLevel,
          entityType: params.entityType,
          entityId: params.entityId,
          eventCode: String(params.eventCode)
        }
      })
      .catch(() => null)
  );
  await Promise.all(ops);
  await mirrorNotificationsToAssistant(Array.from(recipients), params.title, params.message).catch(() => undefined);
  return recipients.size;
}

// Универсальный порог низкого остатка (из AppSetting). Если не настроен — 5.
const LOW_STOCK_KEY = "lowStockThreshold";
let cachedThreshold: { value: number; cachedAt: number } | null = null;
const TTL_MS = 30_000;
export async function getLowStockThreshold(): Promise<number> {
  const now = Date.now();
  if (cachedThreshold && now - cachedThreshold.cachedAt < TTL_MS) {
    return cachedThreshold.value;
  }
  const row = await prisma.appSetting.findUnique({ where: { key: LOW_STOCK_KEY } });
  const n = Number(row?.value ?? "5");
  const value = Number.isFinite(n) && n >= 0 ? n : 5;
  cachedThreshold = { value, cachedAt: now };
  return value;
}
export async function setLowStockThreshold(value: number): Promise<void> {
  const safe = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 5;
  await prisma.appSetting.upsert({
    where: { key: LOW_STOCK_KEY },
    create: { key: LOW_STOCK_KEY, value: String(safe) },
    update: { value: String(safe) }
  });
  cachedThreshold = { value: safe, cachedAt: Date.now() };
}
