import { OperationType, StockMovementDirection } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import {
  assertProjectInScope,
  assertWarehouseInScope,
  getRequestDataScope,
  operationWhereFromScope
} from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createOperationSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  warehouseId: z.string().min(1),
  projectId: z.string().optional(),
  storageRoom: z.string().optional(),
  storageCell: z.string().optional(),
  documentNumber: z.string().optional(),
  operationDate: z.string().datetime().optional(),
  items: z
    .array(
      z.object({
        materialId: z.string().min(1),
        quantity: z.number().positive(),
        price: z.number().positive().optional()
      })
    )
    .min(1)
});

export const operationsRouter = Router();
operationsRouter.use(requireAuth);
operationsRouter.use(requirePermission("operations.read"));

operationsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;

  if (warehouseId && !scope.unrestricted && scope.warehouseIds?.length && !scope.warehouseIds.includes(warehouseId)) {
    return res.status(403).json({ error: "FORBIDDEN_WAREHOUSE" });
  }

  const rows = await prisma.operation.findMany({
    where: {
      AND: [
        operationWhereFromScope(scope),
        {
          ...(type ? { type: type as OperationType } : {}),
          ...(warehouseId ? { warehouseId } : {})
        }
      ]
    },
    include: {
      items: true,
      documents: true
    },
    orderBy: { operationDate: "desc" },
    take: 200
  });

  return res.json(rows);
});

operationsRouter.post("/", requirePermission("operations.write"), async (req: AuthedRequest, res) => {
  const parsed = createOperationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const data = parsed.data;

  try {
    const scope = await getRequestDataScope(req);
    assertWarehouseInScope(scope, data.warehouseId);
    assertProjectInScope(scope, data.projectId);
    const created = await prisma.$transaction(async (tx) => {
      const operation = await tx.operation.create({
        data: {
          type: data.type as OperationType,
          warehouseId: data.warehouseId,
          projectId: data.projectId,
          documentNumber: data.documentNumber,
          operationDate: data.operationDate ? new Date(data.operationDate) : new Date(),
          status: "POSTED",
          items: {
            create: data.items.map((item) => ({
              materialId: item.materialId,
              quantity: item.quantity,
              price: item.price
            }))
          }
        },
        include: { items: true }
      });

      for (const item of data.items) {
        const existing = await tx.stock.findUnique({
          where: { warehouseId_materialId: { warehouseId: data.warehouseId, materialId: item.materialId } }
        });

        if (data.type === "INCOME") {
          if (existing) {
            await tx.stock.update({
              where: { warehouseId_materialId: { warehouseId: data.warehouseId, materialId: item.materialId } },
              data: {
                quantity: { increment: item.quantity },
                ...(data.storageRoom !== undefined ? { storageRoom: data.storageRoom || null } : {}),
                ...(data.storageCell !== undefined ? { storageCell: data.storageCell || null } : {})
              }
            });
          } else {
            await tx.stock.create({
              data: {
                warehouseId: data.warehouseId,
                materialId: item.materialId,
                quantity: item.quantity,
                reserved: 0,
                storageRoom: data.storageRoom || null,
                storageCell: data.storageCell || null
              }
            });
          }
        }

        if (data.type === "EXPENSE") {
          if (!existing || Number(existing.quantity) < item.quantity) {
            throw new Error(`INSUFFICIENT_STOCK:${item.materialId}`);
          }
          await tx.stock.update({
            where: { warehouseId_materialId: { warehouseId: data.warehouseId, materialId: item.materialId } },
            data: { quantity: { decrement: item.quantity } }
          });
        }

        await tx.stockMovement.create({
          data: {
            warehouseId: data.warehouseId,
            materialId: item.materialId,
            quantity: item.quantity,
            direction: data.type === "INCOME" ? StockMovementDirection.IN : StockMovementDirection.OUT,
            sourceDocumentType: "OPERATION",
            sourceDocumentId: operation.id,
            operationId: operation.id,
            createdById: req.user!.userId
          }
        });
      }

      return operation;
    });

    await recordAudit({
      userId: req.user!.userId,
      action: "OPERATION_CREATE",
      entityType: "Operation",
      entityId: created.id,
      after: {
        type: created.type,
        warehouseId: created.warehouseId,
        projectId: created.projectId,
        items: created.items?.map((i) => ({ materialId: i.materialId, quantity: i.quantity }))
      }
    });

    return res.status(201).json(created);
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      return res.status(409).json({
        error: "Insufficient stock",
        materialId: error.message.replace("INSUFFICIENT_STOCK:", "")
      });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});
