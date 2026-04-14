import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { normalizePermissions } from "../lib/permissions.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { UserStatus } from "@prisma/client";

const updateUserAccessSchema = z.object({
  roleName: z.string().optional(),
  status: z.enum(["ACTIVE", "BLOCKED"]).optional()
});

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  roleName: z.string().min(1),
  password: z.string().min(4)
});

const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1))
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(4)
});

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requirePermission("admin.users.manage"));

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: { role: true },
    orderBy: { createdAt: "desc" }
  });
  return res.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      status: u.status,
      role: u.role.name,
      permissions: normalizePermissions(u.role.permissions),
      createdAt: u.createdAt
    }))
  );
});

adminRouter.post("/users", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const role = await prisma.role.findUnique({ where: { name: parsed.data.roleName } });
  if (!role) {
    return res.status(404).json({ error: "Role not found" });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const created = await prisma.user.create({
    data: {
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      roleId: role.id,
      passwordHash
    },
    include: { role: true }
  });
  return res.status(201).json({
    id: created.id,
    email: created.email,
    fullName: created.fullName,
    status: created.status,
    role: created.role.name
  });
});

adminRouter.patch("/users/:id/access", async (req, res) => {
  const parsed = updateUserAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const userId = String(req.params.id);
  let roleId: string | undefined;
  if (parsed.data.roleName) {
    const role = await prisma.role.findUnique({ where: { name: parsed.data.roleName } });
    if (!role) {
      return res.status(404).json({ error: "Role not found" });
    }
    roleId = role.id;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(roleId ? { roleId } : {}),
      ...(parsed.data.status ? { status: parsed.data.status as UserStatus } : {})
    },
    include: { role: true }
  });

  return res.json({
    id: updated.id,
    email: updated.email,
    fullName: updated.fullName,
    status: updated.status,
    role: updated.role.name
  });
});

adminRouter.patch("/users/:id/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const userId = String(req.params.id);
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash }
  });
  return res.json({ ok: true });
});

adminRouter.get("/roles", async (_req, res) => {
  const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });
  return res.json(
    roles.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: normalizePermissions(r.permissions)
    }))
  );
});

adminRouter.patch("/roles/:name/permissions", async (req, res) => {
  const parsed = updateRolePermissionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const roleName = String(req.params.name);
  const role = await prisma.role.update({
    where: { name: roleName },
    data: { permissions: parsed.data.permissions }
  });

  return res.json({
    id: role.id,
    name: role.name,
    permissions: normalizePermissions(role.permissions)
  });
});
