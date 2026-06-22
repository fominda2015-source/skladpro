import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { Router, type Request } from "express";
import multer from "multer";
import { ObjectSection, type Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { assertWarehouseInScope, getRequestDataScope } from "../lib/dataScope.js";
import { sha256File } from "../lib/fileHash.js";
import { prisma } from "../lib/prisma.js";
import { decodeUploadedOriginalName, withRepairedFileName } from "../lib/uploadFileName.js";
import { requireAuth, requirePermission, loadUserPermissions, type AuthedRequest } from "../middleware/auth.js";
import { hasPermission } from "../lib/permissions.js";

const uploadDirAbs = path.resolve(process.cwd(), config.uploadsDir);
if (!fs.existsSync(uploadDirAbs)) {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => cb(null, uploadDirAbs),
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const displayName = decodeUploadedOriginalName(file.originalname);
    const safe = displayName.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});

const upload = multer({ storage });

const createLinkSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1)
});

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

function canReadMaterialDocuments(permissions: string[]) {
  return (
    hasPermission(permissions, "documents.read") ||
    hasPermission(permissions, "materials.read") ||
    hasPermission(permissions, "materials.write")
  );
}

function canWriteEntityDocument(permissions: string[], entityType: string) {
  if (hasPermission(permissions, "documents.write") || hasPermission(permissions, "documents.upload")) {
    return true;
  }
  if (entityType === "inbound") return hasPermission(permissions, "documents.read");
  return entityType === "material" && hasPermission(permissions, "materials.write");
}

const inboundMetaSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  comment: z.string().max(2000).optional().nullable(),
  documentDate: z.string().datetime().optional().nullable()
});

documentsRouter.use(async (req: AuthedRequest, res, next) => {
  try {
    const permissions = await loadUserPermissions(req.user!.userId);
    req.user!.permissions = permissions;

    const entityTypeQuery = typeof req.query.entityType === "string" ? req.query.entityType : "";
    const entityIdQuery = typeof req.query.entityId === "string" ? req.query.entityId : "";
    const entityTypeBody = typeof req.body?.entityType === "string" ? req.body.entityType : "";

    if (req.method === "GET" && entityTypeQuery === "material" && entityIdQuery) {
      if (canReadMaterialDocuments(permissions)) return next();
    }
    if (req.method === "POST" && req.path === "/upload" && entityTypeBody === "material") {
      if (canWriteEntityDocument(permissions, "material")) return next();
    }

    if (!hasPermission(permissions, "documents.read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  } catch (e) {
    console.error("documents access check failed:", e);
    return res.status(500).json({ error: "Ошибка проверки доступа" });
  }
});

type EntityIdBatch = { entityType: string; ids: string[] };

async function loadWarehouseEntityBatches(
  warehouseId: string,
  section?: ObjectSection
): Promise<EntityIdBatch[]> {
  const scoped = { warehouseId, ...(section ? { section } : {}) };
  const campWhere = { warehouseId, ...(section ? { section } : {}) };
  const [issues, receipts, operations, tools, campItems, writeoffs] = await Promise.all([
    prisma.issueRequest.findMany({ where: scoped, select: { id: true } }),
    prisma.receiptRequest.findMany({ where: scoped, select: { id: true } }),
    prisma.operation.findMany({ where: scoped, select: { id: true } }),
    prisma.tool.findMany({ where: scoped, select: { id: true } }),
    prisma.campItem.findMany({ where: campWhere, select: { id: true } }),
    prisma.materialHolderWriteoff.findMany({ where: scoped, select: { id: true } })
  ]);
  return [
    { entityType: "issue", ids: issues.map((x) => x.id) },
    { entityType: "receipt", ids: receipts.map((x) => x.id) },
    { entityType: "operation", ids: operations.map((x) => x.id) },
    { entityType: "tool", ids: tools.map((x) => x.id) },
    { entityType: "camp", ids: campItems.map((x) => x.id) },
    { entityType: "material-writeoff", ids: writeoffs.map((x) => x.id) }
  ];
}

function buildDocumentScopeOr(batches: EntityIdBatch[]): Prisma.DocumentFileWhereInput | undefined {
  const entityOr: Prisma.DocumentFileWhereInput[] = [];
  const linkOr: Prisma.DocumentLinkWhereInput[] = [];
  for (const batch of batches) {
    if (!batch.ids.length) continue;
    entityOr.push({ entityType: batch.entityType, entityId: { in: batch.ids } });
    linkOr.push({ entityType: batch.entityType, entityId: { in: batch.ids } });
  }
  if (!entityOr.length && !linkOr.length) return undefined;
  return {
    OR: [
      ...(entityOr.length ? entityOr : []),
      ...(linkOr.length ? [{ links: { some: { OR: linkOr } } }] : [])
    ]
  };
}

documentsRouter.get("/", async (req: AuthedRequest, res) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  const typeParam = typeof req.query.type === "string" ? req.query.type : undefined;
  const actDocumentTypes = [
    "act",
    "issue-act",
    "issue-act-tools",
    "signed-act",
    "transfer_act",
    "issue-signed-attachment"
  ];
  const type =
    typeParam === "act" ? undefined : typeParam;
  const typeIn = typeParam === "act" ? actDocumentTypes : undefined;
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section: ObjectSection | undefined =
    sectionParam === "SS"
      ? ObjectSection.SS
      : sectionParam === "EOM"
        ? ObjectSection.EOM
        : undefined;
  const includeDeleted = req.query.includeDeleted === "1";
  const hasEntityPair = Boolean(entityType && entityId);

  if (warehouseId) {
    try {
      const scope = await getRequestDataScope(req);
      assertWarehouseInScope(scope, warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
  }

  const base: Prisma.DocumentFileWhereInput = {
    ...(typeIn ? { type: { in: typeIn } } : type ? { type } : {}),
    ...(includeDeleted ? {} : { isDeleted: false })
  };

  let warehouseFilter: Prisma.DocumentFileWhereInput | undefined;
  if (warehouseId) {
    const batches = await loadWarehouseEntityBatches(warehouseId, section);
    warehouseFilter = buildDocumentScopeOr(batches);
    if (!warehouseFilter) {
      return res.json([]);
    }
  }

  const where: Prisma.DocumentFileWhereInput =
    hasEntityPair && entityType && entityId
      ? {
          AND: [
            base,
            warehouseFilter ?? {},
            {
              OR: [
                { entityType, entityId },
                { links: { some: { entityType, entityId } } }
              ]
            }
          ]
        }
      : {
          AND: [
            base,
            warehouseFilter ?? {},
            ...(entityType || entityId
              ? [
                  {
                    ...(entityType ? { entityType } : {}),
                    ...(entityId ? { entityId } : {})
                  }
                ]
              : [])
          ]
        };

  const rows = await prisma.documentFile.findMany({
    where,
    ...(hasEntityPair && entityType && entityId
      ? {
          include: {
            links: { where: { entityType, entityId }, take: 1 }
          }
        }
      : {}),
    orderBy: { createdAt: "asc" },
    take: 500
  });

  const repairedRows = rows.map((r) => withRepairedFileName(r));

  if (!hasEntityPair || !entityType || !entityId) {
    return res.json(repairedRows);
  }

  type RowWithLinks = (typeof repairedRows)[number] & { links?: { id: string }[] };
  const withLinks = repairedRows as RowWithLinks[];
  const payload = withLinks.map(({ links, ...f }) => {
    const primaryMatch = f.entityType === entityType && f.entityId === entityId;
    const matchedLinkId =
      !primaryMatch && links && links.length > 0 ? links[0]!.id : null;
    return { ...f, matchedLinkId };
  });
  return res.json(payload);
});

/** Документы приходов: заявки на приход, операции прихода и вручную добавленные. */
documentsRouter.get("/inbound", async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section: ObjectSection | undefined =
    sectionParam === "SS"
      ? ObjectSection.SS
      : sectionParam === "EOM"
        ? ObjectSection.EOM
        : undefined;
  const scope = await getRequestDataScope(req);
  const warehouseIds: string[] = [];
  if (warehouseId) {
    try {
      assertWarehouseInScope(scope, warehouseId);
      warehouseIds.push(warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
  } else if (scope.warehouseIds?.length) {
    warehouseIds.push(...scope.warehouseIds);
  } else if (scope.unrestricted) {
    const all = await prisma.warehouse.findMany({ where: { isActive: true }, select: { id: true } });
    warehouseIds.push(...all.map((w) => w.id));
  }
  if (!warehouseIds.length) {
    return res.json([]);
  }

  const scopedWh = { warehouseId: { in: warehouseIds }, ...(section ? { section } : {}) };
  const [receipts, operations] = await Promise.all([
    prisma.receiptRequest.findMany({ where: scopedWh, select: { id: true, number: true } }),
    prisma.operation.findMany({
      where: { ...scopedWh, type: "INCOME" },
      select: { id: true, documentNumber: true }
    })
  ]);
  const receiptById = new Map(receipts.map((r) => [r.id, r.number]));
  const operationById = new Map(operations.map((o) => [o.id, o.documentNumber]));

  const entityOr: Prisma.DocumentFileWhereInput[] = [];
  const linkOr: Prisma.DocumentLinkWhereInput[] = [];
  for (const whId of warehouseIds) {
    entityOr.push({ entityType: "inbound", entityId: whId });
  }
  if (receipts.length) {
    const ids = receipts.map((r) => r.id);
    entityOr.push({ entityType: "receipt", entityId: { in: ids } });
    linkOr.push({ entityType: "receipt", entityId: { in: ids } });
  }
  if (operations.length) {
    const ids = operations.map((o) => o.id);
    entityOr.push({ entityType: "operation", entityId: { in: ids } });
    linkOr.push({ entityType: "operation", entityId: { in: ids } });
  }

  const rows = await prisma.documentFile.findMany({
    where: {
      isDeleted: false,
      OR: [
        ...entityOr,
        ...(linkOr.length ? [{ links: { some: { OR: linkOr } } }] : [])
      ]
    },
    orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
    take: 1000
  });

  const repaired = rows.map((r) => withRepairedFileName(r));
  const payload = repaired.map((row) => {
    let sourceKind: "manual" | "receipt" | "operation" = "manual";
    let sourceLabel = "Вручную";
    if (row.entityType === "receipt") {
      sourceKind = "receipt";
      sourceLabel = `Заявка ${receiptById.get(row.entityId) || row.entityId.slice(0, 8)}`;
    } else if (row.entityType === "operation") {
      sourceKind = "operation";
      const num = operationById.get(row.entityId);
      sourceLabel = num ? `Приход ${num}` : `Приход ${row.entityId.slice(0, 8)}`;
    } else if (row.entityType === "inbound") {
      sourceKind = "manual";
      sourceLabel = "Вручную";
    }
    return { ...row, sourceKind, sourceLabel };
  });
  return res.json(payload);
});

documentsRouter.post("/inbound/upload", upload.single("file"), async (req: AuthedRequest, res) => {
  const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;
  if (!file) {
    return res.status(400).json({ error: "file is required" });
  }
  const warehouseId = String(req.body.warehouseId || "");
  const title = String(req.body.title || "").trim();
  const comment = String(req.body.comment || "").trim();
  const documentDateRaw = String(req.body.documentDate || "").trim();
  if (!warehouseId) {
    return res.status(400).json({ error: "warehouseId is required" });
  }
  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }
  const permissions = req.user!.permissions ?? (await loadUserPermissions(req.user!.userId));
  if (!canWriteEntityDocument(permissions, "inbound")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const scope = await getRequestDataScope(req);
    assertWarehouseInScope(scope, warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const documentDate = documentDateRaw ? new Date(documentDateRaw) : new Date();
  if (Number.isNaN(documentDate.getTime())) {
    return res.status(400).json({ error: "Invalid documentDate" });
  }

  const absPath = path.join(uploadDirAbs, file.filename);
  const checksumSha256 = await sha256File(absPath);
  const filePath = `${config.uploadsDir}/${file.filename}`.replace(/\\/g, "/");
  const created = await prisma.documentFile.create({
    data: {
      groupId: crypto.randomUUID(),
      version: 1,
      entityType: "inbound",
      entityId: warehouseId,
      type: "inbound-manual",
      title,
      comment: comment || null,
      documentDate,
      fileName: decodeUploadedOriginalName(file.originalname),
      filePath,
      mimeType: file.mimetype,
      size: file.size,
      checksumSha256,
      createdBy: req.user!.userId
    }
  });
  return res.status(201).json({
    ...withRepairedFileName(created),
    sourceKind: "manual" as const,
    sourceLabel: "Вручную"
  });
});

documentsRouter.patch("/:id/meta", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const parsed = inboundMetaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const row = await prisma.documentFile.findUnique({ where: { id } });
  if (!row || row.isDeleted) {
    return res.status(404).json({ error: "Document not found" });
  }
  if (row.entityType !== "inbound") {
    return res.status(400).json({ error: "Редактирование метаданных только для документов, добавленных вручную" });
  }
  const permissions = req.user!.permissions ?? (await loadUserPermissions(req.user!.userId));
  if (!canWriteEntityDocument(permissions, "inbound")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const scope = await getRequestDataScope(req);
    assertWarehouseInScope(scope, row.entityId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const updated = await prisma.documentFile.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title?.trim() || null } : {}),
      ...(parsed.data.comment !== undefined ? { comment: parsed.data.comment?.trim() || null } : {}),
      ...(parsed.data.documentDate !== undefined
        ? { documentDate: parsed.data.documentDate ? new Date(parsed.data.documentDate) : null }
        : {})
    }
  });
  return res.json({ ...withRepairedFileName(updated), sourceKind: "manual", sourceLabel: "Вручную" });
});

documentsRouter.post(
  "/upload",
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      return res.status(400).json({ error: "file is required" });
    }

    const entityType = String(req.body.entityType || "");
    const entityId = String(req.body.entityId || "");
    const type = String(req.body.type || "other");

    if (!entityType || !entityId) {
      return res.status(400).json({ error: "entityType and entityId are required" });
    }

    const permissions = req.user!.permissions ?? (await loadUserPermissions(req.user!.userId));
    if (!canWriteEntityDocument(permissions, entityType)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const absPath = path.join(uploadDirAbs, file.filename);
    const checksumSha256 = await sha256File(absPath);
    const dup = await prisma.documentFile.findFirst({
      where: {
        entityType,
        entityId,
        checksumSha256,
        isDeleted: false
      },
      orderBy: { createdAt: "desc" }
    });
    if (dup) {
      fs.unlink(absPath, () => undefined);
      return res.status(200).json({ ...dup, deduplicated: true });
    }

    const filePath = `${config.uploadsDir}/${file.filename}`.replace(/\\/g, "/");
    const created = await prisma.documentFile.create({
      data: {
        groupId: crypto.randomUUID(),
        version: 1,
        entityType,
        entityId,
        type,
        fileName: decodeUploadedOriginalName(file.originalname),
        filePath,
        mimeType: file.mimetype,
        size: file.size,
        checksumSha256,
        createdBy: req.user!.userId
      }
    });

    return res.status(201).json(withRepairedFileName(created));
  }
);

documentsRouter.post("/:id/links", requirePermission("documents.write"), async (req: AuthedRequest, res) => {
  const documentFileId = String(req.params.id);
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const file = await prisma.documentFile.findUnique({ where: { id: documentFileId } });
  if (!file || file.isDeleted) {
    return res.status(404).json({ error: "Document not found" });
  }
  if (file.entityType === parsed.data.entityType && file.entityId === parsed.data.entityId) {
    return res.status(400).json({ error: "File is already attached to this entity as primary" });
  }

  try {
    const link = await prisma.documentLink.create({
      data: {
        documentFileId,
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        createdById: req.user!.userId
      }
    });
    return res.status(201).json(link);
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Link already exists" });
    }
    throw e;
  }
});

documentsRouter.delete("/links/:linkId", requirePermission("documents.write"), async (req, res) => {
  const linkId = String(req.params.linkId);
  const existing = await prisma.documentLink.findUnique({ where: { id: linkId } });
  if (!existing) {
    return res.status(404).json({ error: "Link not found" });
  }
  await prisma.documentLink.delete({ where: { id: linkId } });
  return res.json({ ok: true });
});

documentsRouter.post(
  "/:id/replace",
  requirePermission("documents.write"),
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const baseId = String(req.params.id);
    const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      return res.status(400).json({ error: "file is required" });
    }

    const base = await prisma.documentFile.findUnique({ where: { id: baseId } });
    if (!base || base.isDeleted) {
      return res.status(404).json({ error: "Document not found" });
    }
    const maxVersion = await prisma.documentFile.findFirst({
      where: { groupId: base.groupId || undefined },
      orderBy: { version: "desc" }
    });
    const groupId = base.groupId || crypto.randomUUID();

    const absPath = path.join(uploadDirAbs, file.filename);
    const checksumSha256 = await sha256File(absPath);
    const filePath = `${config.uploadsDir}/${file.filename}`.replace(/\\/g, "/");
    const created = await prisma.documentFile.create({
      data: {
        groupId,
        version: (maxVersion?.version || 1) + 1,
        entityType: base.entityType,
        entityId: base.entityId,
        type: base.type,
        fileName: decodeUploadedOriginalName(file.originalname),
        filePath,
        mimeType: file.mimetype,
        size: file.size,
        checksumSha256,
        createdBy: req.user!.userId
      }
    });
    await prisma.$transaction([
      prisma.documentFile.update({
        where: { id: base.id },
        data: { replacedById: created.id }
      }),
      prisma.documentLink.updateMany({
        where: { documentFileId: base.id },
        data: { documentFileId: created.id }
      })
    ]);
    return res.status(201).json(withRepairedFileName(created));
  }
);

documentsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const row = await prisma.documentFile.findUnique({ where: { id } });
  if (!row) {
    return res.status(404).json({ error: "Document not found" });
  }
  const permissions = req.user!.permissions ?? (await loadUserPermissions(req.user!.userId));
  if (!canWriteEntityDocument(permissions, row.entityType)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [, updated] = await prisma.$transaction([
    prisma.documentLink.deleteMany({ where: { documentFileId: id } }),
    prisma.documentFile.update({
      where: { id },
      data: { isDeleted: true }
    })
  ]);
  return res.json(updated);
});
