import { Router } from "express";
import { z } from "zod";
import { assertWarehouseInScope, getRequestDataScope } from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const upsertMappingSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  sourceName: z.string().min(1).max(300),
  sourceUnit: z.string().max(60).optional().nullable(),
  targetMaterialId: z.string().min(1)
});

export const materialMappingsRouter = Router();
materialMappingsRouter.use(requireAuth);
materialMappingsRouter.use(requirePermission("materials.read"));

materialMappingsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (warehouseId) {
    try {
      assertWarehouseInScope(scope, warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
  }

  const rows = await prisma.materialMappingLibrary.findMany({
    where: {
      ...(warehouseId ? { warehouseId } : {}),
      ...(section ? { section } : {}),
      ...(q
        ? {
            OR: [
              { sourceName: { contains: q, mode: "insensitive" } },
              { targetMaterial: { name: { contains: q, mode: "insensitive" } } }
            ]
          }
        : {})
    },
    include: {
      targetMaterial: { select: { id: true, name: true, sku: true, unit: true } }
    },
    orderBy: { updatedAt: "desc" },
    take: 500
  });

  return res.json(rows);
});

materialMappingsRouter.put("/", requirePermission("materials.write"), async (req: AuthedRequest, res) => {
  const parsed = upsertMappingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const scope = await getRequestDataScope(req);
  try {
    assertWarehouseInScope(scope, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  const saved = await prisma.materialMappingLibrary.upsert({
    where: {
      warehouseId_section_sourceName_sourceUnit: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        sourceName: parsed.data.sourceName.trim(),
        sourceUnit: parsed.data.sourceUnit?.trim() || ""
      }
    },
    create: {
      warehouseId: parsed.data.warehouseId,
      section: parsed.data.section,
      sourceName: parsed.data.sourceName.trim(),
      sourceUnit: parsed.data.sourceUnit?.trim() || "",
      targetMaterialId: parsed.data.targetMaterialId,
      createdById: req.user!.userId
    },
    update: {
      targetMaterialId: parsed.data.targetMaterialId
    },
    include: { targetMaterial: { select: { id: true, name: true, unit: true, sku: true } } }
  });
  return res.json(saved);
});
