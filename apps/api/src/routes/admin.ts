import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { normalizePermissions } from "../lib/permissions.js";
import { getEffectivePermissions } from "../lib/access.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { UserStatus } from "@prisma/client";

const updateUserAccessSchema = z.object({
  roleName: z.string().optional(),
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  permissions: z.array(z.string().min(1)).optional(),
  positionId: z.string().nullable().optional()
});

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  roleName: z.string().min(1).default("VIEWER"),
  password: z.string().min(4),
  warehouseIds: z.array(z.string().min(1)).default([]),
  projectIds: z.array(z.string().min(1)).default([]),
  permissions: z.array(z.string().min(1)).default([]),
  positionId: z.string().nullable().optional(),
  positionName: z.string().min(2).optional()
});

const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1))
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(4)
});

const setUserScopesSchema = z.object({
  warehouseIds: z.array(z.string().min(1)).default([]),
  projectIds: z.array(z.string().min(1)).default([])
});
const createObjectSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  userIds: z.array(z.string().min(1)).default([])
});
const bindObjectUsersSchema = z.object({
  userIds: z.array(z.string().min(1)).default([])
});

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requirePermission("admin.users.manage"));

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: {
      role: true,
      position: true,
      warehouseScopes: { select: { warehouseId: true } },
      projectScopes: { select: { projectId: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  return res.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      status: u.status,
      role: u.role.name,
      position: u.position?.name || null,
      avatarUrl: u.avatarUrl,
      permissions: getEffectivePermissions(u.role.permissions, u.customPermissions),
      customPermissions: normalizePermissions(u.customPermissions),
      warehouseScopeIds: u.warehouseScopes.map((s) => s.warehouseId),
      projectScopeIds: u.projectScopes.map((s) => s.projectId),
      createdAt: u.createdAt
    }))
  );
});

adminRouter.get("/users/:id/scopes", async (req, res) => {
  const userId = String(req.params.id);
  const [wh, pj] = await Promise.all([
    prisma.userWarehouseScope.findMany({ where: { userId }, select: { warehouseId: true } }),
    prisma.userProjectScope.findMany({ where: { userId }, select: { projectId: true } })
  ]);
  return res.json({
    warehouseIds: wh.map((x) => x.warehouseId),
    projectIds: pj.map((x) => x.projectId)
  });
});

adminRouter.put("/users/:id/scopes", async (req: AuthedRequest, res) => {
  const parsed = setUserScopesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const userId = String(req.params.id);
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return res.status(404).json({ error: "User not found" });
  }

  await prisma.$transaction(async (tx) => {
    const linkedWarehouses = parsed.data.projectIds.length
      ? await tx.project.findMany({
          where: { id: { in: parsed.data.projectIds } },
          select: {
            warehouseId: true,
            warehouseLinks: { select: { warehouseId: true }, take: 1 }
          }
        })
      : [];
    const warehouseIds = Array.from(
      new Set([
        ...parsed.data.warehouseIds,
        ...linkedWarehouses
          .map((x) => x.warehouseId || x.warehouseLinks[0]?.warehouseId || null)
          .filter((x): x is string => Boolean(x))
      ])
    );
    await tx.userWarehouseScope.deleteMany({ where: { userId } });
    await tx.userProjectScope.deleteMany({ where: { userId } });
    if (warehouseIds.length) {
      await tx.userWarehouseScope.createMany({
        data: warehouseIds.map((warehouseId) => ({ userId, warehouseId }))
      });
    }
    if (parsed.data.projectIds.length) {
      await tx.userProjectScope.createMany({
        data: parsed.data.projectIds.map((projectId) => ({ userId, projectId }))
      });
    }
  });

  await recordAudit({
    userId: req.user!.userId,
    action: "USER_SCOPES_SET",
    entityType: "User",
    entityId: userId,
    after: { warehouseIds: parsed.data.warehouseIds, projectIds: parsed.data.projectIds }
  });

  return res.json({
    warehouseIds: parsed.data.warehouseIds,
    projectIds: parsed.data.projectIds
  });
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
  let positionId = parsed.data.positionId ?? null;
  if (parsed.data.positionName?.trim()) {
    const p = await prisma.position.upsert({
      where: { name: parsed.data.positionName.trim() },
      update: {},
      create: { name: parsed.data.positionName.trim() }
    });
    positionId = p.id;
  }
  const linkedWarehouses = parsed.data.projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: parsed.data.projectIds } },
        select: {
          warehouseId: true,
          warehouseLinks: { select: { warehouseId: true }, take: 1 }
        }
      })
    : [];
  const warehouseIds = Array.from(
    new Set([
      ...parsed.data.warehouseIds,
      ...linkedWarehouses
        .map((x) => x.warehouseId || x.warehouseLinks[0]?.warehouseId || null)
        .filter((x): x is string => Boolean(x))
    ])
  );
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: parsed.data.email,
        fullName: parsed.data.fullName.trim(),
        roleId: role.id,
        passwordHash,
        customPermissions: parsed.data.permissions,
        positionId
      },
      include: { role: true, position: true }
    });

    if (warehouseIds.length) {
      await tx.userWarehouseScope.createMany({
        data: warehouseIds.map((warehouseId) => ({ userId: user.id, warehouseId }))
      });
    }
    if (parsed.data.projectIds.length) {
      await tx.userProjectScope.createMany({
        data: parsed.data.projectIds.map((projectId) => ({ userId: user.id, projectId }))
      });
    }
    return user;
  });
  return res.status(201).json({
    id: created.id,
    email: created.email,
    fullName: created.fullName,
    status: created.status,
    role: created.role.name,
    avatarUrl: created.avatarUrl,
    position: created.position?.name || null,
    permissions: getEffectivePermissions(created.role.permissions, created.customPermissions)
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
      ...(parsed.data.status ? { status: parsed.data.status as UserStatus } : {}),
      ...(parsed.data.permissions ? { customPermissions: parsed.data.permissions } : {}),
      ...(Object.prototype.hasOwnProperty.call(parsed.data, "positionId")
        ? { positionId: parsed.data.positionId ?? null }
        : {})
    },
    include: { role: true, position: true }
  });

  return res.json({
    id: updated.id,
    email: updated.email,
    fullName: updated.fullName,
    status: updated.status,
    role: updated.role.name,
    position: updated.position?.name || null,
    permissions: getEffectivePermissions(updated.role.permissions, updated.customPermissions)
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

adminRouter.get("/positions", async (_req, res) => {
  const rows = await prisma.position.findMany({ orderBy: { name: "asc" } });
  return res.json(rows);
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

adminRouter.get("/objects", async (_req, res) => {
  const [warehouses, links] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.userWarehouseScope.findMany({ select: { userId: true, warehouseId: true } })
  ]);
  const userIdsByWarehouse = new Map<string, string[]>();
  for (const l of links) {
    const arr = userIdsByWarehouse.get(l.warehouseId) || [];
    arr.push(l.userId);
    userIdsByWarehouse.set(l.warehouseId, arr);
  }
  return res.json(
    warehouses.map((w) => ({
      id: w.id,
      name: w.name,
      address: w.address,
      isActive: w.isActive,
      userIds: Array.from(new Set(userIdsByWarehouse.get(w.id) || []))
    }))
  );
});

adminRouter.post("/objects", async (req: AuthedRequest, res) => {
  const parsed = createObjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const created = await prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.create({
      data: {
        name: parsed.data.name.trim(),
        address: parsed.data.address?.trim() || null,
        isActive: true
      }
    });
    if (parsed.data.userIds.length) {
      await tx.userWarehouseScope.createMany({
        data: parsed.data.userIds.map((userId) => ({ userId, warehouseId: warehouse.id })),
        skipDuplicates: true
      });
    }
    return warehouse;
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "OBJECT_CREATE",
    entityType: "Warehouse",
    entityId: created.id,
    after: { name: created.name, address: created.address, userIds: parsed.data.userIds }
  });
  return res.status(201).json(created);
});

adminRouter.post("/objects/:id/users", async (req: AuthedRequest, res) => {
  const parsed = bindObjectUsersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const warehouseId = String(req.params.id);
  const object = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!object) return res.status(404).json({ error: "Object not found" });
  if (parsed.data.userIds.length) {
    await prisma.userWarehouseScope.createMany({
      data: parsed.data.userIds.map((userId) => ({ userId, warehouseId })),
      skipDuplicates: true
    });
  }
  await recordAudit({
    userId: req.user!.userId,
    action: "OBJECT_USERS_BIND",
    entityType: "Warehouse",
    entityId: warehouseId,
    after: { userIds: parsed.data.userIds }
  });
  return res.json({ ok: true });
});
