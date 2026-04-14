import fs from "node:fs";
import path from "node:path";
import { Router, type Request } from "express";
import multer from "multer";
import { config } from "../config.js";
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

  const rows = await prisma.documentFile.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {})
    },
    orderBy: { createdAt: "desc" },
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

    const filePath = `${config.uploadsDir}/${file.filename}`.replace(/\\/g, "/");
    const created = await prisma.documentFile.create({
      data: {
        entityType,
        entityId,
        type,
        fileName: file.originalname,
        filePath,
        mimeType: file.mimetype,
        size: file.size,
        createdBy: req.user!.userId
      }
    });

    return res.status(201).json(created);
  }
);
