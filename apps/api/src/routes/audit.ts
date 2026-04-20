import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

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
  Material: "Материал"
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
  TOOL_WRITE_OFF: "Инструмент списан"
};

auditRouter.get("/", async (req, res) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const take = Math.min(Number(req.query.take) || 100, 500);

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(userId ? { userId } : {})
    },
    include: { user: { select: { id: true, email: true, fullName: true } } },
    orderBy: { createdAt: "desc" },
    take
  });
  return res.json(
    rows.map((row) => ({
      ...row,
      actionLabel: ACTION_LABELS[row.action] || row.action,
      entityLabel: ENTITY_LABELS[row.entityType] || row.entityType
    }))
  );
});
