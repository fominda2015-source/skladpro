import { Router } from "express";
import { z } from "zod";
import { getRequestDataScope, warehouseWhereFromScope, assertWarehouseInScope } from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { recordAudit } from "../lib/audit.js";
import { handlePrismaError } from "../lib/errors.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createWarehouseSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  isActive: z.boolean().optional()
});

const updateWarehouseSchema = z.object({
  name: z.string().min(2).optional(),
  address: z.string().nullable().optional(),
  isActive: z.boolean().optional()
});

const grantAccessSchema = z.object({
  userId: z.string().min(1),
  section: z.enum(["SS", "EOM"]).optional()
});

export const warehousesRouter = Router();

warehousesRouter.use(requireAuth);
warehousesRouter.use(requirePermission("warehouses.read"));

warehousesRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const rows = await prisma.warehouse.findMany({
    where: warehouseWhereFromScope(scope),
    orderBy: { createdAt: "desc" }
  });
  return res.json(rows);
});

warehousesRouter.post("/", requirePermission("warehouses.write"), async (req, res) => {
  const parsed = createWarehouseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const created = await prisma.warehouse.create({
    data: {
      name: parsed.data.name,
      address: parsed.data.address,
      isActive: parsed.data.isActive ?? true
    }
  });
  return res.status(201).json(created);
});

warehousesRouter.patch(
  "/:id",
  requirePermission("warehouses.write"),
  async (req: AuthedRequest, res) => {
    const warehouseId = String(req.params.id);
    const parsed = updateWarehouseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    try {
      const scope = await getRequestDataScope(req);
      assertWarehouseInScope(scope, warehouseId);
      const updated = await prisma.warehouse.update({
        where: { id: warehouseId },
        data: parsed.data
      });
      return res.json(updated);
    } catch (error) {
      const handled = handlePrismaError(error);
      return res.status(handled.status).json(handled.body);
    }
  }
);

async function requireWarehouseGrantAccess(req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const perms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
  if (req.user.role === "ADMIN" || perms.includes("warehouses.write") || perms.includes("admin.users.manage")) {
    return next();
  }
  return res.status(403).json({ error: "Недостаточно прав" });
}

warehousesRouter.post(
  "/:id/grant-access",
  requireWarehouseGrantAccess,
  async (req: AuthedRequest, res) => {
    const warehouseId = String(req.params.id);
    const parsed = grantAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    try {
      const scope = await getRequestDataScope(req);
      assertWarehouseInScope(scope, warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
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
      summary: `Выдан доступ к объекту «${warehouse.name}»: ${user.fullName || user.email}`,
      after: { userId: user.id, section: parsed.data.section ?? null }
    });

    return res.json({ ok: true });
  }
);
