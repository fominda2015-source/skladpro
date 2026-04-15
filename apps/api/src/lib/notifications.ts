import { NotificationLevel } from "@prisma/client";
import { prisma } from "./prisma.js";

type NotifyParams = {
  userId: string;
  title: string;
  message: string;
  level?: NotificationLevel;
  entityType?: string;
  entityId?: string;
};

export async function notifyUser(params: NotifyParams) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      title: params.title,
      message: params.message,
      level: params.level ?? NotificationLevel.INFO,
      entityType: params.entityType,
      entityId: params.entityId
    }
  });
}
