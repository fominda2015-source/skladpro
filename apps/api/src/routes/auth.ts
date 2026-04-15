import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { normalizePermissions } from "../lib/permissions.js";
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

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { role: true }
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const roleName = user.role.name as RoleName;
  const permissions = normalizePermissions(user.role.permissions);
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
      role: roleName,
      permissions
    }
  });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { role: true }
  });
  if (!me) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json({
    id: me.id,
    email: me.email,
    fullName: me.fullName,
    avatarUrl: me.avatarUrl,
    role: me.role.name,
    permissions: normalizePermissions(me.role.permissions)
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
    include: { role: true }
  });

  return res.json({
    id: updated.id,
    email: updated.email,
    fullName: updated.fullName,
    avatarUrl: updated.avatarUrl,
    role: updated.role.name,
    permissions: normalizePermissions(updated.role.permissions)
  });
});
