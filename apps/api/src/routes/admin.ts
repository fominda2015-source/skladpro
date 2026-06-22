import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import { createDemoData, deleteDemoData, getDemoDataStatus } from "../lib/demoData.js";
import { prisma } from "../lib/prisma.js";
import { normalizePermissions } from "../lib/permissions.js";
import { getEffectivePermissions } from "../lib/access.js";
import {
  membersFromObjectScopes,
  syncObjectMembers,
  type ObjectMemberInput
} from "../lib/objectAccess.js";
import { requireAdminRole, requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { UserStatus } from "@prisma/client";

const updateUserAccessSchema = z.object({
  roleName: z.string().optional(),
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  permissions: z.array(z.string().min(1)).optional(),
  positionId: z.string().nullable().optional(),
  isMol: z.boolean().optional()
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
  positionName: z.string().min(2).optional(),
  isMol: z.boolean().optional()
});

const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1))
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(4)
});

const setUserScopesSchema = z.object({
  warehouseIds: z.array(z.string().min(1)).default([]),
  projectIds: z.array(z.string().min(1)).default([]),
  sectionScopes: z
    .array(
      z.object({
        warehouseId: z.string().min(1),
        section: z.enum(["SS", "EOM"])
      })
    )
    .default([])
});
const createObjectSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  userIds: z.array(z.string().min(1)).default([])
});
const bindObjectUsersSchema = z.object({
  userIds: z.array(z.string().min(1)).default([])
});
const bindObjectSectionUsersSchema = z.object({
  userIds: z.array(z.string().min(1)).default([])
});
const objectMemberSchema = z.object({
  userId: z.string().min(1),
  sections: z.array(z.enum(["SS", "EOM"])).nullable()
});
const syncObjectMembersSchema = z.object({
  members: z.array(objectMemberSchema).default([])
});

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requireAdminRole);

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: {
      role: true,
      position: true,
      warehouseScopes: { select: { warehouseId: true } },
      projectScopes: { select: { projectId: true } },
      warehouseSectionScopes: { select: { warehouseId: true, section: true } }
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
      sectionScopes: u.warehouseSectionScopes,
      isMol: u.isMol,
      createdAt: u.createdAt
    }))
  );
});

adminRouter.get("/users/:id/scopes", async (req, res) => {
  const userId = String(req.params.id);
  const [wh, pj, sec] = await Promise.all([
    prisma.userWarehouseScope.findMany({ where: { userId }, select: { warehouseId: true } }),
    prisma.userProjectScope.findMany({ where: { userId }, select: { projectId: true } }),
    prisma.userWarehouseSectionScope.findMany({ where: { userId }, select: { warehouseId: true, section: true } })
  ]);
  return res.json({
    warehouseIds: wh.map((x) => x.warehouseId),
    projectIds: pj.map((x) => x.projectId),
    sectionScopes: sec
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

  const [prevWh, prevPj, prevSec] = await Promise.all([
    prisma.userWarehouseScope.findMany({ where: { userId }, select: { warehouseId: true } }),
    prisma.userProjectScope.findMany({ where: { userId }, select: { projectId: true } }),
    prisma.userWarehouseSectionScope.findMany({
      where: { userId },
      select: { warehouseId: true, section: true }
    })
  ]);

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
    await tx.userWarehouseSectionScope.deleteMany({ where: { userId } });
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
    if (parsed.data.sectionScopes.length) {
      await tx.userWarehouseSectionScope.createMany({
        data: parsed.data.sectionScopes.map((s) => ({
          userId,
          warehouseId: s.warehouseId,
          section: s.section
        })),
        skipDuplicates: true
      });
    }
  });

  await recordAudit({
    userId: req.user!.userId,
    action: "USER_SCOPES_SET",
    entityType: "User",
    entityId: userId,
    summary: `Изменены области доступа: ${target.fullName || target.email}`,
    before: {
      warehouseIds: prevWh.map((x) => x.warehouseId),
      projectIds: prevPj.map((x) => x.projectId),
      sectionScopes: prevSec
    },
    after: {
      warehouseIds: parsed.data.warehouseIds,
      projectIds: parsed.data.projectIds,
      sectionScopes: parsed.data.sectionScopes
    }
  });

  return res.json({
    warehouseIds: parsed.data.warehouseIds,
    projectIds: parsed.data.projectIds,
    sectionScopes: parsed.data.sectionScopes
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
        positionId,
        isMol: Boolean(parsed.data.isMol)
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
      customPermissions: [],
      ...(Object.prototype.hasOwnProperty.call(parsed.data, "positionId")
        ? { positionId: parsed.data.positionId ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(parsed.data, "isMol") ? { isMol: parsed.data.isMol } : {})
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
    isMol: updated.isMol,
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
  const [warehouses, links, sectionLinks] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.userWarehouseScope.findMany({ select: { userId: true, warehouseId: true } }),
    prisma.userWarehouseSectionScope.findMany({ select: { userId: true, warehouseId: true, section: true } })
  ]);
  const userIdsByWarehouse = new Map<string, string[]>();
  for (const l of links) {
    const arr = userIdsByWarehouse.get(l.warehouseId) || [];
    arr.push(l.userId);
    userIdsByWarehouse.set(l.warehouseId, arr);
  }
  const sectionUserIdsByWarehouse = new Map<string, { SS: string[]; EOM: string[] }>();
  for (const l of sectionLinks) {
    const current = sectionUserIdsByWarehouse.get(l.warehouseId) || { SS: [], EOM: [] };
    current[l.section].push(l.userId);
    sectionUserIdsByWarehouse.set(l.warehouseId, current);
  }
  return res.json(
    warehouses.map((w) => {
      const userIds = Array.from(new Set(userIdsByWarehouse.get(w.id) || []));
      const sectionUsers = {
        SS: Array.from(new Set(sectionUserIdsByWarehouse.get(w.id)?.SS || [])),
        EOM: Array.from(new Set(sectionUserIdsByWarehouse.get(w.id)?.EOM || []))
      };
      return {
        id: w.id,
        name: w.name,
        address: w.address,
        isActive: w.isActive,
        userIds,
        sectionUsers,
        members: membersFromObjectScopes(userIds, sectionUsers)
      };
    })
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
      await syncObjectMembers(
        tx,
        warehouse.id,
        parsed.data.userIds.map((userId) => ({ userId, sections: null }))
      );
    }
    return warehouse;
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "OBJECT_CREATE",
    entityType: "Warehouse",
    entityId: created.id,
    summary: `Создан объект: ${created.name}`,
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
  const before = await prisma.userWarehouseScope.findMany({
    where: { warehouseId },
    select: { userId: true }
  });
  const beforeIds = before.map((x) => x.userId);
  const newlyAdded = parsed.data.userIds.filter((id) => !beforeIds.includes(id));
  if (parsed.data.userIds.length) {
    await prisma.userWarehouseScope.createMany({
      data: parsed.data.userIds.map((userId) => ({ userId, warehouseId })),
      skipDuplicates: true
    });
  }
  await recordAudit({
    userId: req.user!.userId,
    action: "OBJECT_USERS_ADD",
    entityType: "Warehouse",
    entityId: warehouseId,
    summary: `Добавлено пользователей: ${newlyAdded.length} (объект ${object.name})`,
    before: { userIds: beforeIds, addedIds: newlyAdded },
    after: { userIds: parsed.data.userIds }
  });
  return res.json({ ok: true });
});

adminRouter.put("/objects/:id/sections/:section/users", async (req: AuthedRequest, res) => {
  const parsed = bindObjectSectionUsersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const warehouseId = String(req.params.id);
  const sectionRaw = String(req.params.section).toUpperCase();
  if (sectionRaw !== "SS" && sectionRaw !== "EOM") {
    return res.status(400).json({ error: "Invalid section. Use SS or EOM." });
  }
  const section = sectionRaw as "SS" | "EOM";
  const object = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!object) return res.status(404).json({ error: "Object not found" });
  const beforeSection = await prisma.userWarehouseSectionScope.findMany({
    where: { warehouseId, section },
    select: { userId: true }
  });
  await prisma.$transaction(async (tx) => {
    if (parsed.data.userIds.length) {
      await tx.userWarehouseScope.createMany({
        data: parsed.data.userIds.map((userId) => ({ userId, warehouseId })),
        skipDuplicates: true
      });
    }
    await tx.userWarehouseSectionScope.deleteMany({
      where: {
        warehouseId,
        section,
        ...(parsed.data.userIds.length ? { userId: { notIn: parsed.data.userIds } } : {})
      }
    });
    if (parsed.data.userIds.length) {
      await tx.userWarehouseSectionScope.createMany({
        data: parsed.data.userIds.map((userId) => ({ userId, warehouseId, section })),
        skipDuplicates: true
      });
    }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "OBJECT_SECTION_USERS_SYNC",
    entityType: "Warehouse",
    entityId: warehouseId,
    summary: `Обновлены доступы по разделу ${section} объекта ${object.name}`,
    before: { section, userIds: beforeSection.map((x) => x.userId) },
    after: { section, userIds: parsed.data.userIds }
  });
  return res.json({ ok: true });
});

adminRouter.delete("/users/:id", async (req: AuthedRequest, res) => {
  const userId = String(req.params.id);
  if (userId === req.user!.userId) {
    return res.status(400).json({ error: "SELF_DELETE_FORBIDDEN" });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true }
  });
  if (!target) {
    return res.status(404).json({ error: "User not found" });
  }

  // `?force=1` или { "force": true } в теле — принудительно удалить даже при наличии истории.
  // Без force — старое поведение: блокируем 409, если найдены ссылки.
  const force =
    String(req.query.force ?? "").toLowerCase() === "1" ||
    String(req.query.force ?? "").toLowerCase() === "true" ||
    (req.body && (req.body as { force?: unknown }).force === true);

  const [issueCount, docLinkCount, mhwHolderCount, mhwActorCount, transferCount] = await Promise.all([
    prisma.issueRequest.count({ where: { requestedById: userId } }),
    prisma.documentLink.count({ where: { createdById: userId } }),
    prisma.materialHolderWriteoff.count({ where: { holderUserId: userId } }),
    prisma.materialHolderWriteoff.count({ where: { actorUserId: userId } }),
    prisma.transferRequest.count({ where: { requestedById: userId } })
  ]);
  const hasReferences =
    issueCount > 0 || docLinkCount > 0 || mhwHolderCount > 0 || mhwActorCount > 0 || transferCount > 0;

  if (hasReferences && !force) {
    return res.status(409).json({
      error: "USER_HAS_REFERENCES",
      issuesAsAuthor: issueCount,
      documentLinks: docLinkCount,
      materialReportAsHolder: mhwHolderCount,
      materialReportAsActor: mhwActorCount,
      transferRequests: transferCount,
      hint: "Передайте force=1 в query, чтобы переписать историю на текущего админа и удалить пользователя."
    });
  }

  // Force-режим: переписываем RESTRICT-связи на текущего администратора, чтобы FK не блокировали удаление.
  // Cascade-связи (Notification, ChatMessage, Scope, NotificationRule, ActionLog и т.п.) почистятся автоматически.
  await prisma.$transaction(async (tx) => {
    if (force && hasReferences) {
      const adminId = req.user!.userId;
      await tx.issueRequest.updateMany({
        where: { requestedById: userId },
        data: { requestedById: adminId }
      });
      await tx.issueRequest.updateMany({
        where: { approvedById: userId },
        data: { approvedById: null }
      });
      const mhwAsHolder = await tx.materialHolderWriteoff.findMany({
        where: { holderUserId: userId },
        select: { id: true, holderKey: true }
      });
      const adminUser = await tx.user.findUnique({
        where: { id: adminId },
        select: { fullName: true, email: true }
      });
      const adminLabel = adminUser?.fullName || adminUser?.email || adminId;
      for (const row of mhwAsHolder) {
        const nextKey = row.holderKey.startsWith("user:") ? `user:${adminId}` : row.holderKey;
        await tx.materialHolderWriteoff.update({
          where: { id: row.id },
          data: {
            holderUserId: adminId,
            holderKey: nextKey,
            holderName: adminLabel
          }
        });
      }
      await tx.materialHolderWriteoff.updateMany({
        where: { actorUserId: userId },
        data: { actorUserId: adminId }
      });
      await tx.transferRequest.updateMany({
        where: { requestedById: userId },
        data: { requestedById: adminId }
      });
      // DocumentLink.createdById может быть Restrict (зависит от схемы) — на всякий случай тоже переписываем.
      await tx.documentLink.updateMany({
        where: { createdById: userId },
        data: { createdById: adminId }
      }).catch(() => undefined);
    }
    await tx.user.delete({ where: { id: userId } });
  });

  await recordAudit({
    userId: req.user!.userId,
    action: "USER_DELETE",
    entityType: "User",
    entityId: userId,
    summary: `Удалён пользователь ${target.fullName || target.email}${force && hasReferences ? " (force, история перепривязана)" : ""}`,
    before: { email: target.email, fullName: target.fullName, force, hasReferences }
  });
  return res.json({ ok: true, force, rewroteHistory: force && hasReferences });
});

adminRouter.delete("/objects/:id", async (req: AuthedRequest, res) => {
  const warehouseId = String(req.params.id);
  const wh = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, name: true }
  });
  if (!wh) {
    return res.status(404).json({ error: "Object not found" });
  }

  // `?force=1` или { "force": true } — снести объект вместе со всеми связанными данными.
  const force =
    String(req.query.force ?? "").toLowerCase() === "1" ||
    String(req.query.force ?? "").toLowerCase() === "true" ||
    (req.body && (req.body as { force?: unknown }).force === true);

  const [opCnt, mvCnt, issCnt, mhwCnt, transferFromCnt, transferToCnt] = await Promise.all([
    prisma.operation.count({ where: { warehouseId } }),
    prisma.stockMovement.count({ where: { warehouseId } }),
    prisma.issueRequest.count({ where: { warehouseId } }),
    prisma.materialHolderWriteoff.count({ where: { warehouseId } }),
    prisma.transferRequest.count({ where: { fromWarehouseId: warehouseId } }),
    prisma.transferRequest.count({ where: { toWarehouseId: warehouseId } })
  ]);
  const hasData = opCnt + mvCnt + issCnt + mhwCnt + transferFromCnt + transferToCnt > 0;

  if (hasData && !force) {
    return res.status(409).json({
      error: "WAREHOUSE_NOT_EMPTY",
      operations: opCnt,
      stockMovements: mvCnt,
      issues: issCnt,
      materialReport: mhwCnt,
      transfers: transferFromCnt + transferToCnt,
      hint: "Передайте force=1 в query, чтобы удалить объект вместе со всеми его данными."
    });
  }

  // Force-режим: вычищаем RESTRICT-связи руками, остальное удалит cascade на стороне БД.
  // Порядок важен: сначала листья, потом владельцы.
  await prisma.$transaction(
    async (tx) => {
      if (force && hasData) {
        // Сбросим связанные waybills (ссылаются на operation/issueRequest косвенно — pre-cleanup на всякий случай).
        await tx.transportWaybill.deleteMany({
          where: {
            OR: [
              { fromWarehouseId: warehouseId },
              { issueRequest: { warehouseId } },
              { operation: { warehouseId } }
            ]
          }
        });
        // StockMovement (Restrict) → удалить.
        await tx.stockMovement.deleteMany({ where: { warehouseId } });
        // Operation (Restrict) — удалить (Operation сам cascade-удалит OperationItem/OperationDocument).
        await tx.operation.deleteMany({ where: { warehouseId } });
        // IssueRequest (Restrict) — удалить (cascade-удалит позиции и tool-связи).
        await tx.issueRequest.deleteMany({ where: { warehouseId } });
        // Material report (Restrict) — удалить.
        await tx.materialHolderWriteoff.deleteMany({ where: { warehouseId } });
        // Transfer requests — оба направления (FK Restrict).
        await tx.transferRequest.deleteMany({
          where: { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] }
        });
      }
      // На всякий случай отвяжем активный склад у пользователей (User.activeWarehouseId Restrict).
      await tx.user.updateMany({
        where: { activeWarehouseId: warehouseId },
        data: { activeWarehouseId: null, activeSection: null }
      });
      await tx.warehouse.delete({ where: { id: warehouseId } });
    },
    { timeout: 60_000 }
  );
  await recordAudit({
    userId: req.user!.userId,
    action: "OBJECT_DELETE",
    entityType: "Warehouse",
    entityId: warehouseId,
    summary: `Удалён объект (склад) ${wh.name}${force && hasData ? " (force, удалены связанные данные)" : ""}`,
    before: { name: wh.name, force, hasData }
  });
  return res.json({ ok: true, force, wipedData: force && hasData });
});

adminRouter.put("/objects/:id/members", async (req: AuthedRequest, res) => {
  const parsed = syncObjectMembersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const warehouseId = String(req.params.id);
  const object = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!object) return res.status(404).json({ error: "Object not found" });

  const beforeUsers = await prisma.userWarehouseScope.findMany({
    where: { warehouseId },
    select: { userId: true }
  });
  const beforeSections = await prisma.userWarehouseSectionScope.findMany({
    where: { warehouseId },
    select: { userId: true, section: true }
  });

  const members = parsed.data.members as ObjectMemberInput[];
  await prisma.$transaction((tx) => syncObjectMembers(tx, warehouseId, members));

  await recordAudit({
    userId: req.user!.userId,
    action: "OBJECT_MEMBERS_SYNC",
    entityType: "Warehouse",
    entityId: warehouseId,
    summary: `Обновлены участники объекта ${object.name}`,
    before: {
      userIds: beforeUsers.map((x) => x.userId),
      sectionScopes: beforeSections
    },
    after: { members }
  });
  return res.json({ ok: true });
});

adminRouter.put("/objects/:id/users", async (req: AuthedRequest, res) => {
  const parsed = bindObjectUsersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const warehouseId = String(req.params.id);
  const object = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!object) return res.status(404).json({ error: "Object not found" });
  const beforeUsers = await prisma.userWarehouseScope.findMany({
    where: { warehouseId },
    select: { userId: true }
  });
  await prisma.$transaction(async (tx) => {
    await tx.userWarehouseScope.deleteMany({
      where: {
        warehouseId,
        ...(parsed.data.userIds.length ? { userId: { notIn: parsed.data.userIds } } : {})
      }
    });
    if (parsed.data.userIds.length) {
      await tx.userWarehouseScope.createMany({
        data: parsed.data.userIds.map((userId) => ({ userId, warehouseId })),
        skipDuplicates: true
      });
    }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "OBJECT_USERS_SYNC",
    entityType: "Warehouse",
    entityId: warehouseId,
    summary: `Обновлён список пользователей объекта ${object.name}`,
    before: { userIds: beforeUsers.map((x) => x.userId) },
    after: { userIds: parsed.data.userIds }
  });
  return res.json({ ok: true });
});

adminRouter.get("/demo-data", async (_req, res) => {
  const status = await getDemoDataStatus();
  return res.json(status);
});

adminRouter.post("/demo-data", async (_req, res) => {
  const result = await createDemoData();
  return res.status(result.created ? 201 : 200).json(result);
});

adminRouter.delete("/demo-data", async (req, res) => {
  const force =
    String(req.query.force ?? "").toLowerCase() === "1" ||
    String(req.query.force ?? "").toLowerCase() === "true";
  const result = await deleteDemoData({ force });
  return res.json(result);
});

adminRouter.get("/data-jobs", async (_req, res) => {
  const { listDataJobs } = await import("../lib/dataJobs/runner.js");
  return res.json(await listDataJobs());
});

adminRouter.get("/data-jobs/runs", async (req, res) => {
  const takeRaw = Number(req.query.take);
  const take = Number.isFinite(takeRaw) ? takeRaw : 50;
  const { listDataJobRuns } = await import("../lib/dataJobs/runner.js");
  return res.json(await listDataJobRuns(take));
});

adminRouter.post("/data-jobs/run-pending", async (req: AuthedRequest, res) => {
  const { listDataJobs, runDataJob } = await import("../lib/dataJobs/runner.js");
  const jobs = await listDataJobs();
  const pending = jobs.filter((j) => j.pendingDeploy);
  const results = [];
  for (const job of pending) {
    results.push(
      await runDataJob(job.id, {
        triggeredById: req.user!.userId,
        source: "admin"
      })
    );
  }
  await recordAudit({
    userId: req.user!.userId,
    action: "ADMIN_DATA_JOBS_RUN_PENDING",
    entityType: "DataJobRun",
    entityId: "batch",
    summary: `Обслуживание БД: выполнено ожидающих задач ${results.length}`,
    after: { results: results.map((r) => ({ jobId: r.jobId, status: r.status })) }
  });
  return res.json({ count: results.length, results });
});

const runDataJobSchema = z.object({
  force: z.boolean().optional()
});

adminRouter.post("/data-jobs/:jobId/run", async (req: AuthedRequest, res) => {
  const parsed = runDataJobSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const jobId = String(req.params.jobId);
  const { getDataRebuildJob } = await import("../lib/dataJobs/catalog.js");
  const { runDataJob } = await import("../lib/dataJobs/runner.js");
  if (!getDataRebuildJob(jobId)) {
    return res.status(404).json({ error: "Задача не найдена" });
  }
  try {
    const result = await runDataJob(jobId, {
      force: parsed.data.force,
      triggeredById: req.user!.userId,
      source: "admin"
    });
    await recordAudit({
      userId: req.user!.userId,
      action: "ADMIN_DATA_JOB_RUN",
      entityType: "DataJobRun",
      entityId: result.runId || jobId,
      summary: `Обслуживание БД · ${jobId} · ${result.status}${parsed.data.force ? " (принудительно)" : ""}`,
      after: { jobId, status: result.status, summary: result.summary, error: result.error }
    });
    if (result.status === "FAIL") {
      return res.status(500).json({ ...result, error: result.error || "Ошибка выполнения" });
    }
    return res.json(result);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 409) return res.status(409).json({ error: err.message });
    throw e;
  }
});
