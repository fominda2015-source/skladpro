import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { getEffectivePermissions } from "../lib/access.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import type { RoleName } from "../types.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4)
});

const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  avatarUrl: z.string().max(500000).nullable().optional()
});
const updateContextSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]).default("SS")
});

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
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { role: true, position: true, activeWarehouse: { select: { id: true, name: true, address: true } } }
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: "Invalid credentials" });
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
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { role: true, position: true, activeWarehouse: { select: { id: true, name: true, address: true } } }
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
  if (!objects.some((x) => x.id === parsed.data.warehouseId)) {
    return res.status(403).json({ error: "FORBIDDEN_WAREHOUSE" });
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
  if (!me) {
    return res.status(404).json({ error: "User not found" });
  }

  const passwordOk = await bcrypt.compare(parsed.data.currentPassword, me.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: me.id },
    data: { passwordHash: newPasswordHash }
  });

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
