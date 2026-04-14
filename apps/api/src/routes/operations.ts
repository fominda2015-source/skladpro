import { OperationType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const createOperationSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  warehouseId: z.string().min(1),
  projectId: z.string().optional(),
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

operationsRouter.get("/", async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;

  const rows = await prisma.operation.findMany({
    where: {
      ...(type ? { type: type as OperationType } : {}),
      ...(warehouseId ? { warehouseId } : {})
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

operationsRouter.post("/", requirePermission("operations.write"), async (req, res) => {
  const parsed = createOperationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const data = parsed.data;

  try {
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
              data: { quantity: { increment: item.quantity } }
            });
          } else {
            await tx.stock.create({
              data: {
                warehouseId: data.warehouseId,
                materialId: item.materialId,
                quantity: item.quantity,
                reserved: 0
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
      }

      return operation;
    });

    return res.status(201).json(created);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      return res.status(409).json({
        error: "Insufficient stock",
        materialId: error.message.replace("INSUFFICIENT_STOCK:", "")
      });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});
