import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export async function recordAudit(opts: {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  warehouseId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  tx?: Prisma.TransactionClient;
}) {
  const db = opts.tx ?? prisma;
  const warehouseId =
    opts.warehouseId ??
    (opts.entityType === "Warehouse" ? opts.entityId : inferWarehouseIdFromPayload(opts.after, opts.before));
  await db.auditLog.create({
    data: {
      userId: opts.userId,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      warehouseId: warehouseId ?? undefined,
      summary: opts.summary ?? undefined,
      beforeData: opts.before === undefined ? undefined : (opts.before as Prisma.InputJsonValue),
      afterData: opts.after === undefined ? undefined : (opts.after as Prisma.InputJsonValue),
      ip: opts.ip ?? undefined,
      userAgent: opts.userAgent ?? undefined
    }
  });
}

function inferWarehouseIdFromPayload(after?: unknown, before?: unknown): string | null {
  for (const payload of [after, before]) {
    if (payload && typeof payload === "object" && "warehouseId" in payload) {
      const id = (payload as { warehouseId?: unknown }).warehouseId;
      if (typeof id === "string" && id) return id;
    }
  }
  return null;
}
