import { Router } from "express";
import { z } from "zod";
import { getRequestDataScope, warehouseWhereFromScope, assertWarehouseInScope } from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
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
