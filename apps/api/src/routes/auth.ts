import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import type { Request } from "express";
import { z } from "zod";
import { UserStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { getEffectivePermissions } from "../lib/access.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import type { RoleName } from "../types.js";

const ADMIN_EMAIL = "admin@skladpro.local";
const ADMIN_PASSWORD = "1111";

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4)
});

const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  /** Поддержка небольших data URL вручную; для обычных фото см. POST /auth/me/avatar */
  avatarUrl: z.string().max(900_000).nullable().optional()
});

const avatarUploadDirAbs = path.resolve(process.cwd(), config.uploadsDir);
if (!fs.existsSync(avatarUploadDirAbs)) {
  fs.mkdirSync(avatarUploadDirAbs, { recursive: true });
}
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req: Request, _file, cb) => cb(null, avatarUploadDirAbs),
    filename: (_req: Request, file, cb) => {
      const ext = path.extname(file.originalname || "") || ".jpg";
      cb(null, `avatar_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("INVALID_AVATAR_TYPE"));
      return;
    }
    cb(null, true);
  }
});

const updateContextSchema = z.object({
  warehouseId: z.string().min(1).nullable(),
  section: z.enum(["SS", "EOM"]).default("SS")
});

const loginUserInclude = {
  role: true,
  position: true,
  activeWarehouse: { select: { id: true, name: true, address: true } }
} as const;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function findLoginUser(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: normalizeEmail(email), mode: "insensitive" } },
    include: loginUserInclude
  });
}

async function ensureDefaultAdmin() {
  const role = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: { permissions: ["*"] },
    create: { name: "ADMIN", permissions: ["*"] }
  });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const existing = await findLoginUser(ADMIN_EMAIL);
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        email: ADMIN_EMAIL,
        fullName: existing.fullName || config.adminName,
        passwordHash,
        roleId: role.id,
        status: UserStatus.ACTIVE,
        customPermissions: []
      }
    });
  } else {
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        fullName: config.adminName,
        passwordHash,
        roleId: role.id,
        status: UserStatus.ACTIVE
      }
    });
  }
  return findLoginUser(ADMIN_EMAIL);
}

async function getAllowedWarehouses(userId: string, permissions: string[]) {
  if (permissions.includes("*")) {
    return prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true }
    });
  }
  const scopes = await prisma.userWarehouseScope.findMany({
    where: { userId },
    select: { warehouse: { select: { id: true, name: true, address: true } } }
  });
  return scopes.map((x) => x.warehouse);
}

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Введите email и пароль" });
    }

    const email = normalizeEmail(parsed.data.email);
    const password = parsed.data.password;
    const isDefaultAdmin = email === ADMIN_EMAIL && password === ADMIN_PASSWORD;

    let user = await findLoginUser(email);

    if (isDefaultAdmin) {
      user = await ensureDefaultAdmin();
    }

    if (!user) {
      return res.status(401).json({ error: "Учетная запись не найдена" });
    }

    if (user.status === UserStatus.BLOCKED && !isDefaultAdmin) {
      return res.status(403).json({ error: "Учетная запись заблокирована" });
    }

    const passwordOk = isDefaultAdmin
      ? true
      : await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: "Неверный пароль" });
    }

    const roleName = user.role.name as RoleName;
    const permissions = getEffectivePermissions(user.role.permissions, user.customPermissions);
    const allowedWarehouses = await getAllowedWarehouses(user.id, permissions);
    const activeWarehouseId =
      user.activeWarehouseId && allowedWarehouses.some((w) => w.id === user.activeWarehouseId)
        ? user.activeWarehouseId
        : allowedWarehouses[0]?.id || null;
    if (activeWarehouseId && activeWarehouseId !== user.activeWarehouseId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { activeWarehouseId, activeSection: user.activeSection || "SS" }
      });
    }

    const token = jwt.sign(
      { userId: user.id, role: roleName, email: user.email, permissions },
      config.jwtSecret,
      { expiresIn: "12h" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        position: user.position?.name || null,
        role: roleName,
        permissions,
        activeWarehouseId,
        activeSection: user.activeSection || "SS",
        requireObjectSelection: !activeWarehouseId,
        availableObjects: allowedWarehouses
      }
    });
  } catch (err) {
    console.error("login error", err);
    return res.status(500).json({ error: "Ошибка сервера при входе" });
  }
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: loginUserInclude
  });
  if (!me) {
    return res.status(404).json({ error: "User not found" });
  }
  const permissions = getEffectivePermissions(me.role.permissions, me.customPermissions);
  const allowedWarehouses = await getAllowedWarehouses(me.id, permissions);
  const activeWarehouseId =
    me.activeWarehouseId && allowedWarehouses.some((w) => w.id === me.activeWarehouseId)
      ? me.activeWarehouseId
      : allowedWarehouses[0]?.id || null;
  return res.json({
    id: me.id,
    email: me.email,
    fullName: me.fullName,
    avatarUrl: me.avatarUrl,
    position: me.position?.name || null,
    role: me.role.name,
    permissions,
    activeWarehouseId,
    activeSection: me.activeSection || "SS",
    requireObjectSelection: !activeWarehouseId,
    availableObjects: allowedWarehouses
  });
});

authRouter.get("/context", requireAuth, async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { role: true, activeWarehouse: { select: { id: true, name: true, address: true } } }
  });
  if (!me) return res.status(404).json({ error: "User not found" });
  const permissions = getEffectivePermissions(me.role.permissions, me.customPermissions);
  const objects = await getAllowedWarehouses(me.id, permissions);
  return res.json({
    activeWarehouseId: me.activeWarehouseId,
    activeSection: me.activeSection || "SS",
    objects
  });
});

authRouter.put("/context", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateContextSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const me = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { role: true }
  });
  if (!me) return res.status(404).json({ error: "User not found" });
  const permissions = getEffectivePermissions(me.role.permissions, me.customPermissions);
  const objects = await getAllowedWarehouses(me.id, permissions);
  if (parsed.data.warehouseId !== null) {
    if (!objects.some((x) => x.id === parsed.data.warehouseId)) {
      return res.status(403).json({ error: "FORBIDDEN_WAREHOUSE" });
    }
  }
  const updated = await prisma.user.update({
    where: { id: me.id },
    data: {
      activeWarehouseId: parsed.data.warehouseId,
      activeSection: parsed.data.section
    }
  });
  return res.json({
    activeWarehouseId: updated.activeWarehouseId,
    activeSection: updated.activeSection || "SS"
  });
});

authRouter.post("/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const me = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!me) return res.status(404).json({ error: "User not found" });
  const passwordOk = await bcrypt.compare(parsed.data.currentPassword, me.passwordHash);
  if (!passwordOk) return res.status(401).json({ error: "Текущий пароль неверный" });
  const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: newPasswordHash } });
  return res.json({ ok: true });
});

authRouter.patch("/me/profile", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data: {
      ...(typeof parsed.data.fullName === "string" ? { fullName: parsed.data.fullName.trim() } : {}),
      ...(Object.prototype.hasOwnProperty.call(parsed.data, "avatarUrl")
        ? { avatarUrl: parsed.data.avatarUrl ?? null }
        : {})
    },
    include: { role: true, position: true }
  });
  return res.json({
    id: updated.id,
    email: updated.email,
    fullName: updated.fullName,
    avatarUrl: updated.avatarUrl,
    position: updated.position?.name || null,
    role: updated.role.name,
    permissions: getEffectivePermissions(updated.role.permissions, updated.customPermissions)
  });
});

authRouter.post("/me/avatar", requireAuth, async (req: AuthedRequest, res) => {
  avatarUpload.single("file")(req, res, async (err: unknown) => {
    if (err) {
      const msg =
        err instanceof Error && err.message === "INVALID_AVATAR_TYPE"
          ? "Нужен файл изображения"
          : "Не удалось загрузить файл (до 4 МБ, форматы изображений)";
      return res.status(400).json({ error: msg });
    }
    try {
      const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;
      if (!file) {
        return res.status(400).json({ error: 'Прикрепите файл в поле "file"' });
      }
      const relative = `${config.uploadsDir}/${file.filename}`.replace(/\\/g, "/");
      const updated = await prisma.user.update({
        where: { id: req.user!.userId },
        data: { avatarUrl: relative },
        include: { role: true, position: true }
      });
      return res.json({
        id: updated.id,
        email: updated.email,
        fullName: updated.fullName,
        avatarUrl: updated.avatarUrl,
        position: updated.position?.name || null,
        role: updated.role.name,
        permissions: getEffectivePermissions(updated.role.permissions, updated.customPermissions)
      });
    } catch (e) {
      console.error("avatar upload failed", e);
      return res.status(500).json({ error: "Не удалось сохранить аватар" });
    }
  });
});
