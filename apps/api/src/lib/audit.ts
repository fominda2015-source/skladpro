import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export async function recordAudit(opts: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  tx?: Prisma.TransactionClient;
}) {
  const db = opts.tx ?? prisma;
  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      beforeData: opts.before === undefined ? undefined : (opts.before as Prisma.InputJsonValue),
      afterData: opts.after === undefined ? undefined : (opts.after as Prisma.InputJsonValue),
      ip: opts.ip ?? undefined,
      userAgent: opts.userAgent ?? undefined
    }
  });
}
