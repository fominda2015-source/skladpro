import { CampItemCategory, CampItemStatus, ObjectSection, Prisma } from "@prisma/client";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { assertWarehouseInScope, getRequestDataScope, type DataScope } from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const uploadDirAbs = path.resolve(process.cwd(), config.uploadsDir);
if (!fs.existsSync(uploadDirAbs)) {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
}
const upload = multer({ storage: multer.memoryStorage() });

const categoryEnum = z.nativeEnum(CampItemCategory);
const statusEnum = z.nativeEnum(CampItemStatus);
const sectionEnum = z.nativeEnum(ObjectSection);

const createSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  category: categoryEnum.optional(),
  inventoryNumber: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  section: sectionEnum.optional(),
  status: statusEnum.optional(),
  acquiredAt: z.string().datetime().optional().nullable()
});

const updateSchema = createSchema.partial();

function campItemWhereFromScope(scope: DataScope): Prisma.CampItemWhereInput {
  if (scope.unrestricted) return {};
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({
        warehouseId: s.warehouseId,
        section: s.section
      }))
    };
  }
  if (!scope.warehouseIds?.length) {
    return {};
  }
  return {
    OR: [{ warehouseId: { in: scope.warehouseIds } }, { warehouseId: null }]
  };
}

async function loadAttachments(campItemIds: string[]) {
  if (!campItemIds.length) return new Map<string, any[]>();
  const files = await prisma.documentFile.findMany({
    where: { entityType: "camp", entityId: { in: campItemIds }, isDeleted: false },
    orderBy: { createdAt: "desc" }
  });
  const map = new Map<string, typeof files>();
  for (const f of files) {
    const list = map.get(f.entityId) || [];
    list.push(f);
    map.set(f.entityId, list);
  }
  return map;
}

export const campItemsRouter = Router();
campItemsRouter.use(requireAuth);
campItemsRouter.use(requirePermission("materials.read"));

campItemsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const where: Prisma.CampItemWhereInput = { ...campItemWhereFromScope(scope) };

  const { warehouseId, section, category, status, q } = req.query;
  if (typeof warehouseId === "string" && warehouseId) where.warehouseId = warehouseId;
  if (typeof section === "string" && section) {
    const parsed = sectionEnum.safeParse(section);
    if (parsed.success) where.section = parsed.data;
  }
  if (typeof category === "string" && category) {
    const parsed = categoryEnum.safeParse(category);
    if (parsed.success) where.category = parsed.data;
  }
  if (typeof status === "string" && status) {
    const parsed = statusEnum.safeParse(status);
    if (parsed.success) where.status = parsed.data;
  }
  if (typeof q === "string" && q.trim()) {
    const term = q.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { inventoryNumber: { contains: term, mode: "insensitive" } },
      { serialNumber: { contains: term, mode: "insensitive" } },
      { manufacturer: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } }
    ];
  }

  const items = await prisma.campItem.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } }
    }
  });
  const attachmentsMap = await loadAttachments(items.map((i) => i.id));
  const result = items.map((i) => {
    const attachments = attachmentsMap.get(i.id) || [];
    const photos = attachments.filter((a: any) => a.type === "photo");
    const docs = attachments.filter((a: any) => a.type !== "photo");
    return {
      ...i,
      photos: photos.map((p: any) => ({
        id: p.id,
        fileName: p.fileName,
        filePath: p.filePath,
        size: p.size,
        mimeType: p.mimeType,
        createdAt: p.createdAt
      })),
      documents: docs.map((d: any) => ({
        id: d.id,
        fileName: d.fileName,
        filePath: d.filePath,
        type: d.type,
        size: d.size,
        mimeType: d.mimeType,
        createdAt: d.createdAt
      }))
    };
  });
  return res.json(result);
});

campItemsRouter.post(
  "/",
  requirePermission("materials.write"),
  upload.array("files", 20),
  async (req: AuthedRequest, res) => {
    let payload: unknown = req.body;
    if (typeof req.body?.payload === "string") {
      try {
        payload = JSON.parse(req.body.payload);
      } catch {
        return res.status(400).json({ error: "payload должен быть валидным JSON" });
      }
    }
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const scope = await getRequestDataScope(req);
    if (parsed.data.warehouseId) {
      try {
        assertWarehouseInScope(scope, parsed.data.warehouseId);
      } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status === 403) return res.status(403).json({ error: err.message });
        throw e;
      }
    }
    const data = parsed.data;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.campItem.create({
        data: {
          name: data.name.trim(),
          category: data.category ?? CampItemCategory.OTHER,
          inventoryNumber: data.inventoryNumber?.trim() || null,
          serialNumber: data.serialNumber?.trim() || null,
          manufacturer: data.manufacturer?.trim() || null,
          location: data.location?.trim() || null,
          description: data.description?.trim() || null,
          warehouseId: data.warehouseId || null,
          section: data.section ?? ObjectSection.SS,
          status: data.status ?? CampItemStatus.IN_USE,
          acquiredAt: data.acquiredAt ? new Date(data.acquiredAt) : null,
          createdById: req.user?.userId ?? null
        }
      });
      for (const f of files) {
        if (!f.buffer || !f.size) continue;
        const safe = f.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storedFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
        await fs.promises.writeFile(path.join(uploadDirAbs, storedFileName), f.buffer);
        const isPhoto = (f.mimetype || "").startsWith("image/");
        await tx.documentFile.create({
          data: {
            groupId: crypto.randomUUID(),
            version: 1,
            entityType: "camp",
            entityId: row.id,
            type: isPhoto ? "photo" : "document",
            fileName: f.originalname,
            filePath: `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/"),
            mimeType: f.mimetype,
            size: f.size,
            checksumSha256: crypto.createHash("sha256").update(f.buffer).digest("hex"),
            createdBy: req.user!.userId
          }
        });
      }
      return row;
    });
    return res.json(created);
  }
);

campItemsRouter.patch(
  "/:id",
  requirePermission("materials.write"),
  async (req: AuthedRequest, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const id = String(req.params.id);
    const scope = await getRequestDataScope(req);
    const found = await prisma.campItem.findFirst({
      where: { id, ...campItemWhereFromScope(scope) }
    });
    if (!found) return res.status(404).json({ error: "Не найдено" });
    if (parsed.data.warehouseId) {
      try {
        assertWarehouseInScope(scope, parsed.data.warehouseId);
      } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status === 403) return res.status(403).json({ error: err.message });
        throw e;
      }
    }
    const data = parsed.data;
    const updated = await prisma.campItem.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.inventoryNumber !== undefined ? { inventoryNumber: data.inventoryNumber?.trim() || null } : {}),
        ...(data.serialNumber !== undefined ? { serialNumber: data.serialNumber?.trim() || null } : {}),
        ...(data.manufacturer !== undefined ? { manufacturer: data.manufacturer?.trim() || null } : {}),
        ...(data.location !== undefined ? { location: data.location?.trim() || null } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.warehouseId !== undefined ? { warehouseId: data.warehouseId || null } : {}),
        ...(data.section !== undefined ? { section: data.section } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.acquiredAt !== undefined ? { acquiredAt: data.acquiredAt ? new Date(data.acquiredAt) : null } : {})
      }
    });
    return res.json(updated);
  }
);

campItemsRouter.delete(
  "/:id",
  requirePermission("materials.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const scope = await getRequestDataScope(req);
    const found = await prisma.campItem.findFirst({
      where: { id, ...campItemWhereFromScope(scope) }
    });
    if (!found) return res.status(404).json({ error: "Не найдено" });
    await prisma.$transaction(async (tx) => {
      // Помечаем все привязанные файлы как удалённые (soft).
      await tx.documentFile.updateMany({
        where: { entityType: "camp", entityId: id, isDeleted: false },
        data: { isDeleted: true }
      });
      await tx.campItem.delete({ where: { id } });
    });
    return res.json({ ok: true });
  }
);

campItemsRouter.post(
  "/:id/files",
  requirePermission("materials.write"),
  upload.array("files", 20),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const scope = await getRequestDataScope(req);
    const found = await prisma.campItem.findFirst({
      where: { id, ...campItemWhereFromScope(scope) }
    });
    if (!found) return res.status(404).json({ error: "Не найдено" });
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) return res.status(400).json({ error: "Файлы не получены" });

    const created: any[] = [];
    for (const f of files) {
      if (!f.buffer || !f.size) continue;
      const safe = f.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storedFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      await fs.promises.writeFile(path.join(uploadDirAbs, storedFileName), f.buffer);
      const isPhoto = (f.mimetype || "").startsWith("image/");
      const doc = await prisma.documentFile.create({
        data: {
          groupId: crypto.randomUUID(),
          version: 1,
          entityType: "camp",
          entityId: id,
          type: isPhoto ? "photo" : "document",
          fileName: f.originalname,
          filePath: `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/"),
          mimeType: f.mimetype,
          size: f.size,
          checksumSha256: crypto.createHash("sha256").update(f.buffer).digest("hex"),
          createdBy: req.user!.userId
        }
      });
      created.push(doc);
    }
    return res.json({ files: created });
  }
);

campItemsRouter.delete(
  "/:id/files/:fileId",
  requirePermission("materials.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const fileId = String(req.params.fileId);
    const scope = await getRequestDataScope(req);
    const found = await prisma.campItem.findFirst({
      where: { id, ...campItemWhereFromScope(scope) }
    });
    if (!found) return res.status(404).json({ error: "Не найдено" });
    await prisma.documentFile.updateMany({
      where: { id: fileId, entityType: "camp", entityId: id },
      data: { isDeleted: true }
    });
    return res.json({ ok: true });
  }
);
