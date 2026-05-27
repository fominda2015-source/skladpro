import { NotificationLevel } from "@prisma/client";

// Каталог событий, по которым может приходить уведомление.
// Добавляйте сюда новые eventCode, чтобы они появились в настройках правил.
export const NOTIFICATION_EVENTS = [
  {
    code: "RECEIPT_CREATED",
    label: "Загружена новая заявка на приход",
    defaultLevel: NotificationLevel.INFO,
    group: "Приходы"
  },
  {
    code: "RECEIPT_ACCEPTED",
    label: "Приёмка по заявке проведена",
    defaultLevel: NotificationLevel.INFO,
    group: "Приходы"
  },
  {
    code: "ISSUE_CREATED",
    label: "Создана заявка на выдачу",
    defaultLevel: NotificationLevel.INFO,
    group: "Выдачи"
  },
  {
    code: "ISSUE_APPROVED",
    label: "Заявка на выдачу согласована",
    defaultLevel: NotificationLevel.INFO,
    group: "Выдачи"
  },
  {
    code: "ISSUE_REJECTED",
    label: "Заявка на выдачу отклонена",
    defaultLevel: NotificationLevel.WARNING,
    group: "Выдачи"
  },
  {
    code: "ISSUE_ISSUED",
    label: "Выдача по заявке проведена",
    defaultLevel: NotificationLevel.INFO,
    group: "Выдачи"
  },
  {
    code: "ISSUE_CANCELLED",
    label: "Заявка на выдачу отменена",
    defaultLevel: NotificationLevel.WARNING,
    group: "Выдачи"
  },
  {
    code: "ISSUE_DELETED",
    label: "Заявка на выдачу удалена",
    defaultLevel: NotificationLevel.WARNING,
    group: "Выдачи"
  },
  {
    code: "RECEIPT_CANCELLED",
    label: "Заявка на приход отменена",
    defaultLevel: NotificationLevel.WARNING,
    group: "Приходы"
  },
  {
    code: "RECEIPT_DELETED",
    label: "Заявка на приход удалена",
    defaultLevel: NotificationLevel.WARNING,
    group: "Приходы"
  },
  {
    code: "STOCK_LOW",
    label: "Низкий остаток по позиции",
    defaultLevel: NotificationLevel.WARNING,
    group: "Склад"
  },
  {
    code: "STOCK_NEGATIVE",
    label: "Остаток ушёл в минус",
    defaultLevel: NotificationLevel.ERROR,
    group: "Склад"
  },
  {
    code: "LIMIT_OVERRUN",
    label: "Перерасход по лимиту материала",
    defaultLevel: NotificationLevel.ERROR,
    group: "Лимиты"
  },
  {
    code: "LIMIT_TEMPLATE_UPLOADED",
    label: "Загружен новый шаблон лимита",
    defaultLevel: NotificationLevel.INFO,
    group: "Лимиты"
  },
  {
    code: "TOOL_ISSUED",
    label: "Инструмент выдан",
    defaultLevel: NotificationLevel.INFO,
    group: "Инструменты"
  },
  {
    code: "TOOL_RETURNED",
    label: "Инструмент возвращён",
    defaultLevel: NotificationLevel.INFO,
    group: "Инструменты"
  },
  {
    code: "TOOL_LOST",
    label: "Инструмент помечен утерянным",
    defaultLevel: NotificationLevel.ERROR,
    group: "Инструменты"
  },
  {
    code: "TRANSFER_REQUESTED",
    label: "Запрошен трансфер материала между объектами",
    defaultLevel: NotificationLevel.INFO,
    group: "Перемещения"
  },
  {
    code: "FEEDBACK_NEW",
    label: "Новый отклик / обратная связь",
    defaultLevel: NotificationLevel.INFO,
    group: "Прочее"
  }
] as const;

export type NotificationEventCode = (typeof NOTIFICATION_EVENTS)[number]["code"];

const codes = new Set<string>(NOTIFICATION_EVENTS.map((e) => e.code));
export function isKnownEventCode(code: string): code is NotificationEventCode {
  return codes.has(code);
}
