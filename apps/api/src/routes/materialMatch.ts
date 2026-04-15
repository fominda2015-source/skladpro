import { MaterialMatchQueueStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import { matchIncomingMaterial } from "../lib/materialMatchEngine.js";
import { normalizeMaterialName } from "../lib/materialNormalize.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const trySchema = z.object({
  rawName: z.string().min(1),
  unit: z.string().optional(),
  article: z.string().optional(),
  enqueue: z.boolean().optional(),
  source: z.string().optional()
});

export const materialMatchRouter = Router();
materialMatchRouter.use(requireAuth);

const AUTO_SAFE_THRESHOLD = 0.92;

materialMatchRouter.post("/try", requirePermission("materials.read"), async (req: AuthedRequest, res) => {
  const parsed = trySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const materials = await prisma.material.findMany({
    select: { id: true, name: true, sku: true, synonyms: { select: { value: true } } },
    take: 4000,
    orderBy: { createdAt: "desc" }
  });

  const result = matchIncomingMaterial(parsed.data.rawName, materials, { article: parsed.data.article });
  const norm = normalizeMaterialName(parsed.data.rawName) || parsed.data.rawName.trim();

  if (!result.matched && parsed.data.enqueue) {
    if (result.suggestedMaterialId && result.confidence >= AUTO_SAFE_THRESHOLD) {
      const autoResolved = await prisma.materialMatchQueue.create({
        data: {
          rawName: parsed.data.rawName.trim(),
          normalizedName: norm,
          unit: parsed.data.unit,
          article: parsed.data.article,
          status: MaterialMatchQueueStatus.RESOLVED,
          confidence: result.confidence,
          suggestedMaterialId: result.suggestedMaterialId,
          resolvedMaterialId: result.suggestedMaterialId,
          source: parsed.data.source,
          createdById: req.user!.userId
        },
        include: { resolvedMaterial: true, suggestedMaterial: true }
      });
      const value = parsed.data.rawName.trim();
      const dup = await prisma.materialSynonym.findFirst({
        where: { materialId: result.suggestedMaterialId, value }
      });
      if (!dup) {
        await prisma.materialSynonym.create({
          data: { materialId: result.suggestedMaterialId, value }
        });
      }
      return res.json({ ...result, autoResolved: true, queueEntry: autoResolved });
    }
    const row = await prisma.materialMatchQueue.create({
      data: {
        rawName: parsed.data.rawName.trim(),
        normalizedName: norm,
        unit: parsed.data.unit,
        article: parsed.data.article,
        status: MaterialMatchQueueStatus.PENDING,
        confidence: result.confidence,
        suggestedMaterialId: result.suggestedMaterialId,
        source: parsed.data.source,
        createdById: req.user!.userId
      },
      include: { suggestedMaterial: true }
    });
    return res.json({ ...result, queueEntry: row });
  }

  if (result.matched && result.materialId) {
    const mat = await prisma.material.findUnique({
      where: { id: result.materialId },
      include: { synonyms: true }
    });
    return res.json({ ...result, material: mat });
  }

  return res.json(result);
});

materialMatchRouter.get("/queue", requirePermission("materials.read"), async (req, res) => {
  const statusParam = typeof req.query.status === "string" ? req.query.status : "";
  const status =
    statusParam && Object.values(MaterialMatchQueueStatus).includes(statusParam as MaterialMatchQueueStatus)
      ? (statusParam as MaterialMatchQueueStatus)
      : MaterialMatchQueueStatus.PENDING;
  const rows = await prisma.materialMatchQueue.findMany({
    where: { status },
    include: { suggestedMaterial: true, resolvedMaterial: true },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

materialMatchRouter.patch("/queue/:id/resolve", requirePermission("materials.match"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const body = z.object({ materialId: z.string().min(1), addSynonym: z.boolean().optional() }).safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
  }

  const q = await prisma.materialMatchQueue.findUnique({ where: { id } });
  if (!q || q.status !== MaterialMatchQueueStatus.PENDING) {
    return res.status(404).json({ error: "Not found" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.materialMatchQueue.update({
      where: { id },
      data: {
        status: MaterialMatchQueueStatus.RESOLVED,
        resolvedMaterialId: body.data.materialId,
        confidence: 1
      }
    });
    if (body.data.addSynonym !== false) {
      const value = q.rawName.trim();
      const dup = await tx.materialSynonym.findFirst({
        where: { materialId: body.data.materialId, value }
      });
      if (!dup) {
        await tx.materialSynonym.create({
          data: { materialId: body.data.materialId, value }
        });
      }
    }
  });

  const updated = await prisma.materialMatchQueue.findUnique({
    where: { id },
    include: { resolvedMaterial: true, suggestedMaterial: true }
  });

  await recordAudit({
    userId: req.user!.userId,
    action: "MATERIAL_MATCH_RESOLVE",
    entityType: "MaterialMatchQueue",
    entityId: id,
    before: { status: q.status, suggestedMaterialId: q.suggestedMaterialId },
    after: { status: "RESOLVED", resolvedMaterialId: body.data.materialId }
  });

  return res.json(updated);
});

materialMatchRouter.patch("/queue/:id/reject", requirePermission("materials.match"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const q = await prisma.materialMatchQueue.findUnique({ where: { id } });
  if (!q || q.status !== MaterialMatchQueueStatus.PENDING) {
    return res.status(404).json({ error: "Not found" });
  }
  const updated = await prisma.materialMatchQueue.update({
    where: { id },
    data: { status: MaterialMatchQueueStatus.REJECTED }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "MATERIAL_MATCH_REJECT",
    entityType: "MaterialMatchQueue",
    entityId: id,
    before: { status: q.status },
    after: { status: "REJECTED" }
  });
  return res.json(updated);
});
