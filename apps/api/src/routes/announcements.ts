import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const uploadDirAbs = path.resolve(process.cwd(), config.uploadsDir, "announcements");
if (!fs.existsSync(uploadDirAbs)) {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("INVALID_FILE_TYPE"));
      return;
    }
    cb(null, true);
  }
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(12000),
  isPinned: z.boolean().optional(),
  expiresAt: z.string().datetime().optional().nullable()
});

const patchSchema = createSchema.partial();

const rowInclude = {
  author: { select: { id: true, fullName: true } },
  attachments: { orderBy: { sortOrder: "asc" as const } }
} as const;

function mapAnnouncement(row: {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; fullName: string } | null;
  attachments: Array<{
    id: string;
    fileName: string;
    filePath: string;
    mimeType: string | null;
    sortOrder: number;
  }>;
}) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isPinned: row.isPinned,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: row.author,
    attachments: row.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sortOrder: a.sortOrder,
      url: a.filePath.replace(/\\/g, "/")
    }))
  };
}

function parseBoolField(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (v === true || v === "true" || v === "1") return true;
  if (v === false || v === "false" || v === "0") return false;
  return undefined;
}

function parseExpiresAt(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "string") return v;
  return undefined;
}

function parseRemoveIds(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch {
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

async function unlinkFile(filePath: string) {
  try {
    await fs.promises.unlink(path.resolve(process.cwd(), filePath));
  } catch {
    /* already removed */
  }
}

async function saveFiles(announcementId: string, files: Express.Multer.File[], startOrder: number) {
  if (!files.length) return;
  const data = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = path.extname(f.originalname || "") || ".jpg";
    const stored = `ann_${announcementId.slice(0, 8)}_${crypto.randomUUID().slice(0, 10)}${ext}`;
    await fs.promises.writeFile(path.join(uploadDirAbs, stored), f.buffer);
    const relative = `${config.uploadsDir}/announcements/${stored}`.replace(/\\/g, "/");
    data.push({
      announcementId,
      fileName: (f.originalname || stored).slice(0, 240),
      filePath: relative,
      mimeType: f.mimetype,
      sortOrder: startOrder + i
    });
  }
  await prisma.announcementAttachment.createMany({ data });
}

function uploadMiddleware(req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) {
  upload.array("files", 12)(req, res, (err: unknown) => {
    if (!err) return next();
    const msg =
      err instanceof Error && err.message === "INVALID_FILE_TYPE"
        ? "Допустимы только изображения"
        : "Не удалось загрузить файлы (до 8 МБ каждый, до 12 файлов)";
    return res.status(400).json({ error: msg });
  });
}

export const announcementsRouter = Router();
announcementsRouter.use(requireAuth);

announcementsRouter.get("/", async (_req: AuthedRequest, res) => {
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: {
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }]
    },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    take: 50,
    include: rowInclude
  });
  return res.json(rows.map(mapAnnouncement));
});

announcementsRouter.post(
  "/",
  requirePermission("announcements.write"),
  uploadMiddleware,
  async (req: AuthedRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const parsed = createSchema.safeParse({
      title: body.title,
      body: body.body,
      isPinned: parseBoolField(body.isPinned),
      expiresAt: parseExpiresAt(body.expiresAt)
    });
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const row = await prisma.announcement.create({
      data: {
        title: parsed.data.title.trim(),
        body: parsed.data.body.trim(),
        isPinned: parsed.data.isPinned ?? false,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        authorId: req.user!.userId
      }
    });
    const files = (req as AuthedRequest & { files?: Express.Multer.File[] }).files || [];
    await saveFiles(row.id, files, 0);
    const full = await prisma.announcement.findUnique({
      where: { id: row.id },
      include: rowInclude
    });
    return res.status(201).json(mapAnnouncement(full!));
  }
);

announcementsRouter.patch(
  "/:id",
  requirePermission("announcements.edit"),
  uploadMiddleware,
  async (req: AuthedRequest, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
    if (!id) {
      return res.status(400).json({ error: "BAD_ID" });
    }
    const body = req.body as Record<string, unknown>;
    const parsed = patchSchema.safeParse({
      title: body.title,
      body: body.body,
      isPinned: parseBoolField(body.isPinned),
      expiresAt: parseExpiresAt(body.expiresAt)
    });
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const data: {
      title?: string;
      body?: string;
      isPinned?: boolean;
      expiresAt?: Date | null;
    } = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title.trim();
    if (parsed.data.body !== undefined) data.body = parsed.data.body.trim();
    if (parsed.data.isPinned !== undefined) data.isPinned = parsed.data.isPinned;
    if (parsed.data.expiresAt !== undefined) data.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;

    const removeIds = parseRemoveIds(body.removeAttachmentIds);
    const files = (req as AuthedRequest & { files?: Express.Multer.File[] }).files || [];

    if (!Object.keys(data).length && !removeIds.length && !files.length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    try {
      if (removeIds.length) {
        const toRemove = await prisma.announcementAttachment.findMany({
          where: { id: { in: removeIds }, announcementId: id }
        });
        await prisma.announcementAttachment.deleteMany({ where: { id: { in: toRemove.map((x) => x.id) } } });
        await Promise.all(toRemove.map((a) => unlinkFile(a.filePath)));
      }

      if (Object.keys(data).length) {
        await prisma.announcement.update({ where: { id }, data });
      }

      if (files.length) {
        const maxOrder = await prisma.announcementAttachment.aggregate({
          where: { announcementId: id },
          _max: { sortOrder: true }
        });
        await saveFiles(id, files, (maxOrder._max.sortOrder ?? -1) + 1);
      }

      const full = await prisma.announcement.findUnique({
        where: { id },
        include: rowInclude
      });
      if (!full) return res.status(404).json({ error: "Not found" });
      return res.json(mapAnnouncement(full));
    } catch {
      return res.status(404).json({ error: "Not found" });
    }
  }
);

announcementsRouter.delete("/:id", requirePermission("announcements.delete"), async (req: AuthedRequest, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!id) {
    return res.status(400).json({ error: "BAD_ID" });
  }
  try {
    const attachments = await prisma.announcementAttachment.findMany({ where: { announcementId: id } });
    await prisma.announcement.delete({ where: { id } });
    await Promise.all(attachments.map((a) => unlinkFile(a.filePath)));
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ error: "Not found" });
  }
});
