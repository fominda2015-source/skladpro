import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { Router, type Request } from "express";
import multer from "multer";
import { config } from "../config.js";
import { sha256File } from "../lib/fileHash.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const uploadDirAbs = path.resolve(process.cwd(), config.uploadsDir);
if (!fs.existsSync(uploadDirAbs)) {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => cb(null, uploadDirAbs),
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});

const upload = multer({ storage });

export const documentsRouter = Router();
documentsRouter.use(requireAuth);
documentsRouter.use(requirePermission("documents.read"));

documentsRouter.get("/", async (req, res) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const includeDeleted = req.query.includeDeleted === "1";

  const rows = await prisma.documentFile.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(type ? { type } : {}),
      ...(includeDeleted ? {} : { isDeleted: false })
    },
    orderBy: [{ groupId: "desc" }, { version: "desc" }],
    take: 200
  });
  return res.json(rows);
});

documentsRouter.post(
  "/upload",
  requirePermission("documents.write"),
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
        fileName: file.originalname,
        filePath,
        mimeType: file.mimetype,
        size: file.size,
        checksumSha256,
        createdBy: req.user!.userId
      }
    });

    return res.status(201).json(created);
  }
);

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
        fileName: file.originalname,
        filePath,
        mimeType: file.mimetype,
        size: file.size,
        checksumSha256,
        createdBy: req.user!.userId
      }
    });
    await prisma.documentFile.update({
      where: { id: base.id },
      data: { replacedById: created.id }
    });
    return res.status(201).json(created);
  }
);

documentsRouter.delete("/:id", requirePermission("documents.write"), async (req, res) => {
  const id = String(req.params.id);
  const row = await prisma.documentFile.findUnique({ where: { id } });
  if (!row) {
    return res.status(404).json({ error: "Document not found" });
  }
  const updated = await prisma.documentFile.update({
    where: { id },
    data: { isDeleted: true }
  });
  return res.json(updated);
});
