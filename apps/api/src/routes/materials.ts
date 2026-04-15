import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { handlePrismaError } from "../lib/errors.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createMaterialSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(1).optional(),
  unit: z.string().min(1),
  category: z.string().min(1).optional(),
  synonyms: z.array(z.string().min(1)).optional()
});

const updateMaterialSchema = z.object({
  name: z.string().min(2).optional(),
  sku: z.string().min(1).nullable().optional(),
  unit: z.string().min(1).optional(),
  category: z.string().min(1).nullable().optional()
});

const addSynonymSchema = z.object({
  value: z.string().min(1)
});

const mergeMaterialsSchema = z.object({
  sourceMaterialId: z.string().min(1),
  targetMaterialId: z.string().min(1),
  reason: z.string().max(500).optional()
});

export const materialsRouter = Router();
materialsRouter.use(requireAuth);
materialsRouter.use(requirePermission("materials.read"));

materialsRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const unit = typeof req.query.unit === "string" ? req.query.unit.trim() : "";
  const includeMerged = req.query.includeMerged === "1";
  const expandMerged = req.query.expandMerged === "1";

  const rows = await prisma.material.findMany({
    where: {
      ...(includeMerged ? {} : { mergedIntoId: null }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { synonyms: { some: { value: { contains: q, mode: "insensitive" } } } }
            ]
          }
        : {}),
      ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
      ...(unit ? { unit: { equals: unit, mode: "insensitive" } } : {})
    },
    include: {
      synonyms: true,
      ...(expandMerged
        ? {
            mergedFrom: {
              where: includeMerged ? {} : { mergedIntoId: { not: null } },
              include: { synonyms: true }
            }
          }
        : {})
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return res.json(rows);
});

materialsRouter.get("/merge-history", async (_req, res) => {
  const rows = await prisma.materialMergeHistory.findMany({
    include: {
      sourceMaterial: { select: { id: true, name: true, sku: true, unit: true } },
      targetMaterial: { select: { id: true, name: true, sku: true, unit: true } },
      actor: { select: { id: true, fullName: true, email: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

materialsRouter.post("/", requirePermission("materials.write"), async (req, res) => {
  const parsed = createMaterialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  try {
    const created = await prisma.material.create({
      data: {
        name: data.name,
        sku: data.sku,
        unit: data.unit,
        category: data.category,
        synonyms: data.synonyms?.length
          ? { create: data.synonyms.map((value) => ({ value: value.trim() })) }
          : undefined
      },
      include: { synonyms: true }
    });

    return res.status(201).json(created);
  } catch (error) {
    const handled = handlePrismaError(error);
    return res.status(handled.status).json(handled.body);
  }
});

materialsRouter.post("/merge", requirePermission("materials.write"), async (req: AuthedRequest, res) => {
  const parsed = mergeMaterialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const { sourceMaterialId, targetMaterialId, reason } = parsed.data;
  if (sourceMaterialId === targetMaterialId) {
    return res.status(400).json({ error: "sourceMaterialId and targetMaterialId must differ" });
  }

  const source = await prisma.material.findUnique({
    where: { id: sourceMaterialId },
    include: {
      synonyms: true,
      stocks: true,
      limitItems: true
    }
  });
  const target = await prisma.material.findUnique({
    where: { id: targetMaterialId },
    include: { synonyms: true }
  });

  if (!source || !target) {
    return res.status(404).json({ error: "Source or target material not found" });
  }
  if (source.mergedIntoId) {
    return res.status(409).json({ error: "Source material is already merged" });
  }
  if (target.mergedIntoId) {
    return res.status(409).json({ error: "Target material is already merged into another material" });
  }

  const mergeResult = await prisma.$transaction(async (tx) => {
    // Merge stocks warehouse-by-warehouse to avoid unique conflicts.
    for (const st of source.stocks) {
      await tx.stock.upsert({
        where: {
          warehouseId_materialId: {
            warehouseId: st.warehouseId,
            materialId: targetMaterialId
          }
        },
        create: {
          warehouseId: st.warehouseId,
          materialId: targetMaterialId,
          quantity: st.quantity,
          reserved: st.reserved
        },
        update: {
          quantity: { increment: st.quantity },
          reserved: { increment: st.reserved }
        }
      });
    }
    await tx.stock.deleteMany({ where: { materialId: sourceMaterialId } });

    // Merge project limit lines and carry planned/issued/reserved balances.
    for (const lim of source.limitItems) {
      await tx.projectLimitItem.upsert({
        where: {
          projectLimitId_materialId: {
            projectLimitId: lim.projectLimitId,
            materialId: targetMaterialId
          }
        },
        create: {
          projectLimitId: lim.projectLimitId,
          materialId: targetMaterialId,
          plannedQty: lim.plannedQty,
          issuedQty: lim.issuedQty,
          reservedQty: lim.reservedQty
        },
        update: {
          plannedQty: { increment: lim.plannedQty },
          issuedQty: { increment: lim.issuedQty },
          reservedQty: { increment: lim.reservedQty }
        }
      });
    }
    await tx.projectLimitItem.deleteMany({ where: { materialId: sourceMaterialId } });

    const synonymValues = new Set([
      ...source.synonyms.map((s) => s.value.trim()).filter(Boolean),
      source.name.trim()
    ]);
    for (const value of synonymValues) {
      const exists = await tx.materialSynonym.findFirst({
        where: { materialId: targetMaterialId, value }
      });
      if (!exists) {
        await tx.materialSynonym.create({
          data: { materialId: targetMaterialId, value }
        });
      }
    }
    await tx.materialSynonym.deleteMany({ where: { materialId: sourceMaterialId } });

    await Promise.all([
      tx.operationItem.updateMany({
        where: { materialId: sourceMaterialId },
        data: { materialId: targetMaterialId }
      }),
      tx.issueRequestItem.updateMany({
        where: { materialId: sourceMaterialId },
        data: { materialId: targetMaterialId }
      }),
      tx.transportWaybillItem.updateMany({
        where: { materialId: sourceMaterialId },
        data: { materialId: targetMaterialId }
      }),
      tx.stockMovement.updateMany({
        where: { materialId: sourceMaterialId },
        data: { materialId: targetMaterialId }
      }),
      tx.materialMatchQueue.updateMany({
        where: { suggestedMaterialId: sourceMaterialId },
        data: { suggestedMaterialId: targetMaterialId }
      }),
      tx.materialMatchQueue.updateMany({
        where: { resolvedMaterialId: sourceMaterialId },
        data: { resolvedMaterialId: targetMaterialId }
      })
    ]);

    await tx.material.update({
      where: { id: sourceMaterialId },
      data: {
        mergedIntoId: targetMaterialId,
        sku: null
      }
    });

    const history = await tx.materialMergeHistory.create({
      data: {
        sourceMaterialId,
        targetMaterialId,
        actorId: req.user?.userId,
        reason: reason?.trim() || undefined,
        payload: {
          sourceName: source.name,
          targetName: target.name,
          sourceUnit: source.unit,
          targetUnit: target.unit
        }
      }
    });

    return history;
  });

  await recordAudit({
    userId: req.user!.userId,
    action: "MATERIAL_MERGE",
    entityType: "Material",
    entityId: sourceMaterialId,
    before: { mergedIntoId: source.mergedIntoId, sourceMaterialId, targetMaterialId: null },
    after: { mergedIntoId: targetMaterialId, targetMaterialId, historyId: mergeResult.id, reason: reason || null }
  });

  return res.status(201).json(mergeResult);
});

materialsRouter.patch("/:id", requirePermission("materials.write"), async (req, res) => {
  const parsed = updateMaterialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const materialId = String(req.params.id);
  try {
    const updated = await prisma.material.update({
      where: { id: materialId },
      data: parsed.data,
      include: { synonyms: true }
    });

    return res.json(updated);
  } catch (error) {
    const handled = handlePrismaError(error);
    return res.status(handled.status).json(handled.body);
  }
});

materialsRouter.post(
  "/:id/synonyms",
  requirePermission("materials.write"),
  async (req, res) => {
    const parsed = addSynonymSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const materialId = String(req.params.id);
    try {
      const synonym = await prisma.materialSynonym.create({
        data: {
          materialId,
          value: parsed.data.value.trim()
        }
      });

      return res.status(201).json(synonym);
    } catch (error) {
      const handled = handlePrismaError(error);
      return res.status(handled.status).json(handled.body);
    }
  }
);

materialsRouter.delete(
  "/:id/synonyms/:synonymId",
  requirePermission("materials.write"),
  async (req, res) => {
    const materialId = String(req.params.id);
    const synonymId = String(req.params.synonymId);

    const deleted = await prisma.materialSynonym.deleteMany({
      where: { id: synonymId, materialId }
    });

    if (!deleted.count) {
      return res.status(404).json({ error: "Synonym not found" });
    }

    return res.status(204).send();
  }
);
