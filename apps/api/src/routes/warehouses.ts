import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import { getRequestDataScope, warehouseWhereFromScope } from "../lib/dataScope.js";
import { handlePrismaError } from "../lib/errors.js";
import {
  loadObjectMembers,
  membersFromObjectScopes,
  syncObjectMembers,
  type ObjectMemberInput
} from "../lib/objectAccess.js";
import { prisma } from "../lib/prisma.js";
import { assertWarehouseMember } from "../lib/warehouseResponsibility.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const createWarehouseSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  isActive: z.boolean().optional(),
  userIds: z.array(z.string().min(1)).optional()
});

const updateWarehouseSchema = z.object({
  name: z.string().min(2).optional(),
  address: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  responsibleUserId: z.string().nullable().optional()
});

const grantAccessSchema = z.object({
  userId: z.string().min(1),
  section: z.enum(["SS", "EOM"]).optional()
});

const objectMemberSchema = z.object({
  userId: z.string().min(1),
  sections: z.array(z.enum(["SS", "EOM"])).nullable()
});

const syncObjectMembersSchema = z.object({
  members: z.array(objectMemberSchema).default([])
});

export const warehousesRouter = Router();

warehousesRouter.use(requireAuth);

warehousesRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const rows = await prisma.warehouse.findMany({
    where: warehouseWhereFromScope(scope),
    orderBy: { createdAt: "desc" }
  });
  return res.json(rows);
});

/** Объекты с участниками — для вкладки «Объекты». */
warehousesRouter.get("/managed", async (req: AuthedRequest, res) => {
  const userId = req.user!.userId;
  const scope = await getRequestDataScope(req);
  const warehouses = await prisma.warehouse.findMany({
    where: warehouseWhereFromScope(scope),
    orderBy: { name: "asc" },
    include: {
      responsibleUser: { select: { id: true, fullName: true, email: true } }
    }
  });
  const ids = warehouses.map((w) => w.id);
  const [links, sectionLinks] = await Promise.all([
    prisma.userWarehouseScope.findMany({
      where: { warehouseId: { in: ids } },
      select: { userId: true, warehouseId: true }
    }),
    prisma.userWarehouseSectionScope.findMany({
      where: { warehouseId: { in: ids } },
      select: { userId: true, warehouseId: true, section: true }
    })
  ]);
  const userIdsByWarehouse = new Map<string, string[]>();
  for (const l of links) {
    const arr = userIdsByWarehouse.get(l.warehouseId) || [];
    arr.push(l.userId);
    userIdsByWarehouse.set(l.warehouseId, arr);
  }
  const sectionUserIdsByWarehouse = new Map<string, { SS: string[]; EOM: string[] }>();
  for (const l of sectionLinks) {
    const current = sectionUserIdsByWarehouse.get(l.warehouseId) || { SS: [], EOM: [] };
    current[l.section].push(l.userId);
    sectionUserIdsByWarehouse.set(l.warehouseId, current);
  }
  return res.json(
    warehouses.map((w) => {
      const memberUserIds = Array.from(new Set(userIdsByWarehouse.get(w.id) || []));
      const sectionUsers = {
        SS: Array.from(new Set(sectionUserIdsByWarehouse.get(w.id)?.SS || [])),
        EOM: Array.from(new Set(sectionUserIdsByWarehouse.get(w.id)?.EOM || []))
      };
      return {
        id: w.id,
        name: w.name,
        address: w.address,
        isActive: w.isActive,
        responsibleUserId: w.responsibleUserId,
        responsibleUser: w.responsibleUser,
        userIds: memberUserIds,
        sectionUsers,
        members: membersFromObjectScopes(memberUserIds, sectionUsers),
        canManage: memberUserIds.includes(userId)
      };
    })
  );
});

warehousesRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createWarehouseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const userId = req.user!.userId;
  const total = await prisma.warehouse.count();
  const memberIds = parsed.data.userIds?.length ? parsed.data.userIds : [userId];
  if (total > 0) {
    const memberOf = await prisma.userWarehouseScope.findFirst({ where: { userId } });
    if (!memberOf) {
      return res.status(403).json({ error: "Создание объектов доступно участникам существующих объектов" });
    }
  }
  const created = await prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.create({
      data: {
        name: parsed.data.name.trim(),
        address: parsed.data.address?.trim() || null,
        isActive: parsed.data.isActive ?? true,
        responsibleUserId: userId
      }
    });
    await syncObjectMembers(
      tx,
      warehouse.id,
      memberIds.map((id) => ({ userId: id, sections: null }))
    );
    return warehouse;
  });
  await recordAudit({
    userId,
    action: "OBJECT_CREATE",
    entityType: "Warehouse",
    entityId: created.id,
    warehouseId: created.id,
    summary: `Создан объект: ${created.name}`,
    after: { name: created.name, address: created.address, userIds: memberIds }
  });
  return res.status(201).json(created);
});

warehousesRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const warehouseId = String(req.params.id);
  const parsed = updateWarehouseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    await assertWarehouseMember(req.user!.userId, warehouseId);
    if (parsed.data.responsibleUserId) {
      const member = await prisma.userWarehouseScope.findFirst({
        where: { userId: parsed.data.responsibleUserId, warehouseId }
      });
      if (!member) {
        return res.status(400).json({ error: "Ответственное лицо должно быть участником объекта" });
      }
    }
    const updated = await prisma.warehouse.update({
      where: { id: warehouseId },
      data: parsed.data
    });
    return res.json(updated);
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: "Нет доступа к объекту" });
    const handled = handlePrismaError(error);
    return res.status(handled.status).json(handled.body);
  }
});

warehousesRouter.put("/:id/members", async (req: AuthedRequest, res) => {
  const warehouseId = String(req.params.id);
  const parsed = syncObjectMembersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    await assertWarehouseMember(req.user!.userId, warehouseId);
    const before = await loadObjectMembers(warehouseId);
    const members = parsed.data.members as ObjectMemberInput[];
    await prisma.$transaction((tx) => syncObjectMembers(tx, warehouseId, members));
    await recordAudit({
      userId: req.user!.userId,
      action: "OBJECT_USERS_SYNC",
      entityType: "Warehouse",
      entityId: warehouseId,
      warehouseId,
      summary: "Обновлён список участников объекта",
      before: { members: before },
      after: { members }
    });
    return res.json({ ok: true });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: "Нет доступа к объекту" });
    throw error;
  }
});

warehousesRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const warehouseId = String(req.params.id);
  try {
    await assertWarehouseMember(req.user!.userId, warehouseId);
    const force = req.query.force === "1" || req.query.force === "true";
    const wh = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: {
        _count: {
          select: {
            stocks: true,
            operations: true,
            issues: true,
            tools: true,
            limitTemplates: true,
            receiptRequests: true,
            campItems: true
          }
        }
      }
    });
    if (!wh) return res.status(404).json({ error: "Объект не найден" });
    const c = wh._count;
    const total =
      c.stocks + c.operations + c.issues + c.tools + c.limitTemplates + c.receiptRequests + c.campItems;
    if (total > 0 && !force) {
      return res.status(409).json({
        error: "WAREHOUSE_NOT_EMPTY",
        operations: c.operations,
        stockMovements: c.stocks,
        issues: c.issues
      });
    }
    await prisma.warehouse.delete({ where: { id: warehouseId } });
    await recordAudit({
      userId: req.user!.userId,
      action: "OBJECT_DELETE",
      entityType: "Warehouse",
      entityId: warehouseId,
      warehouseId,
      summary: `Удалён объект: ${wh.name}`,
      before: { name: wh.name, address: wh.address }
    });
    return res.json({ ok: true });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: "Нет доступа к объекту" });
    throw error;
  }
});

warehousesRouter.post("/:id/grant-access", async (req: AuthedRequest, res) => {
  const warehouseId = String(req.params.id);
  const parsed = grantAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    await assertWarehouseMember(req.user!.userId, warehouseId);
    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) return res.status(404).json({ error: "Warehouse not found" });
    const user = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true, fullName: true, email: true }
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    await prisma.userWarehouseScope.createMany({
      data: [{ userId: user.id, warehouseId }],
      skipDuplicates: true
    });
    if (parsed.data.section) {
      await prisma.userWarehouseSectionScope.createMany({
        data: [{ userId: user.id, warehouseId, section: parsed.data.section }],
        skipDuplicates: true
      });
    }

    await recordAudit({
      userId: req.user!.userId,
      action: "OBJECT_USERS_ADD",
      entityType: "Warehouse",
      entityId: warehouseId,
      warehouseId,
      summary: `Выдан доступ к объекту «${warehouse.name}»: ${user.fullName || user.email}`,
      after: { userId: user.id, section: parsed.data.section ?? null }
    });

    return res.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
});
