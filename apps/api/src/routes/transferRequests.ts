import { TransferRequestStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  assertWarehouseInScope,
  getRequestDataScope,
  transferRequestWhereFromScope
} from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createSchema = z.object({
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  note: z.string().max(4000).optional(),
  lines: z
    .array(
      z.object({
        materialId: z.string().min(1),
        quantity: z.coerce.number().positive().max(1_000_000_000)
      })
    )
    .min(1)
    .max(200)
});

const patchSchema = z.object({
  status: z.nativeEnum(TransferRequestStatus),
  note: z.string().max(4000).optional()
});

export const transferRequestsRouter = Router();
transferRequestsRouter.use(requireAuth);
transferRequestsRouter.use(requirePermission("waybills.read"));

function userHasWarehouse(scope: Awaited<ReturnType<typeof getRequestDataScope>>, warehouseId: string) {
  if (scope.unrestricted && !scope.warehouseIds?.length) return true;
  return scope.warehouseIds?.includes(warehouseId) ?? false;
}

async function userIdsLinkedToWarehouse(warehouseId: string, excludeUserId?: string) {
  const rows = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      OR: [
        { role: { name: "ADMIN" } },
        { warehouseScopes: { some: { warehouseId } } },
        { warehouseSectionScopes: { some: { warehouseId } } }
      ]
    },
    select: { id: true }
  });
  return rows.map((r) => r.id);
}

function serialize(tr: {
  id: string;
  seq: number;
  fromWarehouseId: string;
  toWarehouseId: string;
  section: string;
  requestedById: string;
  status: TransferRequestStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  fromWarehouse?: { id: string; name: string };
  toWarehouse?: { id: string; name: string };
  requestedBy?: { id: string; fullName: string };
  lines?: Array<{ materialId: string; quantity: unknown; material?: { id: string; name: string; unit: string } }>;
}) {
  return {
    id: tr.id,
    number: `ПЕР-${tr.seq}`,
    fromWarehouseId: tr.fromWarehouseId,
    toWarehouseId: tr.toWarehouseId,
    fromWarehouseName: tr.fromWarehouse?.name ?? null,
    toWarehouseName: tr.toWarehouse?.name ?? null,
    section: tr.section,
    requestedById: tr.requestedById,
    requesterName: tr.requestedBy?.fullName ?? null,
    status: tr.status,
    note: tr.note,
    createdAt: tr.createdAt.toISOString(),
    updatedAt: tr.updatedAt.toISOString(),
    lines: (tr.lines ?? []).map((ln) => ({
      materialId: ln.materialId,
      quantity: Number(ln.quantity),
      materialName: ln.material?.name ?? "",
      unit: ln.material?.unit ?? ""
    }))
  };
}

transferRequestsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const where = transferRequestWhereFromScope(scope, req.user!.userId);
  const rows = await prisma.transferRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      fromWarehouse: true,
      toWarehouse: true,
      requestedBy: { select: { id: true, fullName: true } },
      lines: { include: { material: true } }
    }
  });
  return res.json(rows.map(serialize));
});

transferRequestsRouter.post("/", requirePermission("waybills.write"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  if (parsed.data.fromWarehouseId === parsed.data.toWarehouseId) {
    return res.status(400).json({ error: "SAME_WAREHOUSE" });
  }

  try {
    const scope = await getRequestDataScope(req);
    assertWarehouseInScope(scope, parsed.data.fromWarehouseId);
    assertWarehouseInScope(scope, parsed.data.toWarehouseId);

    const materialIds = [...new Set(parsed.data.lines.map((l) => l.materialId))];
    const mats = await prisma.material.findMany({ where: { id: { in: materialIds } }, select: { id: true } });
    if (mats.length !== materialIds.length) {
      return res.status(400).json({ error: "UNKNOWN_MATERIAL" });
    }

    const row = await prisma.transferRequest.create({
      data: {
        fromWarehouseId: parsed.data.fromWarehouseId,
        toWarehouseId: parsed.data.toWarehouseId,
        section: parsed.data.section,
        requestedById: req.user!.userId,
        note: parsed.data.note?.trim() || undefined,
        lines: {
          create: parsed.data.lines.map((l) => ({
            materialId: l.materialId,
            quantity: l.quantity
          }))
        }
      },
      include: {
        fromWarehouse: true,
        toWarehouse: true,
        requestedBy: { select: { id: true, fullName: true } },
        lines: { include: { material: true } }
      }
    });

    const recipients = await userIdsLinkedToWarehouse(parsed.data.fromWarehouseId, req.user!.userId);
    if (recipients.length) {
      await prisma.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          title: "Заявка на перемещение",
          message: `${row.requestedBy?.fullName ?? "Пользователь"} · ${serialize(row).number}: ${row.fromWarehouse.name} → ${row.toWarehouse.name}`,
          entityType: "TransferRequest",
          entityId: row.id
        }))
      });
    }

    return res.status(201).json(serialize(row));
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    throw error;
  }
});

transferRequestsRouter.patch("/:id", requirePermission("waybills.write"), async (req: AuthedRequest, res) => {
  const transferId = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!transferId) {
    return res.status(400).json({ error: "BAD_ID" });
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const scope = await getRequestDataScope(req);
  const vis = transferRequestWhereFromScope(scope, req.user!.userId);

  const existing = await prisma.transferRequest.findFirst({
    where: { AND: [{ id: transferId }, vis] },
    include: {
      fromWarehouse: true,
      toWarehouse: true,
      requestedBy: { select: { id: true, fullName: true } },
      lines: { include: { material: true } }
    }
  });
  if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

  const next = parsed.data.status;
  const uid = req.user!.userId;
  let allowed = false;

  if (
    next === TransferRequestStatus.CANCELLED &&
    existing.status === TransferRequestStatus.NEW &&
    existing.requestedById === uid
  ) {
    allowed = true;
  } else if (existing.status === TransferRequestStatus.NEW && next === TransferRequestStatus.APPROVED) {
    allowed = userHasWarehouse(scope, existing.fromWarehouseId);
  } else if (existing.status === TransferRequestStatus.NEW && next === TransferRequestStatus.REJECTED) {
    allowed = userHasWarehouse(scope, existing.fromWarehouseId);
  } else if (
    existing.status === TransferRequestStatus.APPROVED &&
    next === TransferRequestStatus.DONE
  ) {
    allowed =
      userHasWarehouse(scope, existing.fromWarehouseId) || userHasWarehouse(scope, existing.toWarehouseId);
  }

  if (!allowed) {
    return res.status(403).json({ error: "FORBIDDEN_STATUS" });
  }

  const row = await prisma.transferRequest.update({
    where: { id: existing.id },
    data: {
      status: next,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note.trim() || null } : {})
    },
    include: {
      fromWarehouse: true,
      toWarehouse: true,
      requestedBy: { select: { id: true, fullName: true } },
      lines: { include: { material: true } }
    }
  });

  const label = `Статус ${serialize(row).number}: ${next}`;
  const recipientId = row.requestedById;
  if (recipientId !== uid) {
    await prisma.notification.create({
      data: {
        userId: recipientId,
        title: "Заявка на перемещение",
        message: label,
        entityType: "TransferRequest",
        entityId: row.id
      }
    });
  }

  return res.json(serialize(row));
});
