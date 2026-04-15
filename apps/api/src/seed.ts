import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma.js";
import { config } from "./config.js";

const baseWarehouseOps = [
  "dashboard.read",
  "audit.read",
  "materials.match",
  "warehouses.read",
  "warehouses.write",
  "materials.read",
  "materials.write",
  "operations.read",
  "operations.write",
  "stocks.read",
  "limits.read",
  "limits.write",
  "issues.read",
  "issues.write",
  "issues.approve",
  "documents.read",
  "documents.write",
  "documents.upload",
  "tools.read",
  "tools.write",
  "waybills.read",
  "waybills.write",
  "integrations.read",
  "integrations.write",
  "notifications.read",
  "notifications.write",
  "team.read",
  "team.tasks.write"
] as const;

const defaultRoles = [
  { name: "ADMIN", permissions: ["*"] },
  { name: "WAREHOUSE_MANAGER", permissions: [...baseWarehouseOps] },
  {
    name: "CHIEF_WAREHOUSE",
    permissions: [...baseWarehouseOps]
  },
  {
    name: "STOREKEEPER",
    permissions: [
      "dashboard.read",
      "audit.read",
      "materials.match",
      "warehouses.read",
      "materials.read",
      "materials.write",
      "operations.read",
      "operations.write",
      "stocks.read",
      "limits.read",
      "issues.read",
      "issues.write",
      "documents.read",
      "documents.write",
      "documents.upload",
      "tools.read",
      "tools.write",
      "waybills.read",
      "waybills.write",
      "integrations.read",
      "notifications.read",
      "team.read"
    ]
  },
  {
    name: "FOREMAN",
    permissions: [
      "dashboard.read",
      "warehouses.read",
      "materials.read",
      "stocks.read",
      "limits.read",
      "issues.read",
      "issues.write",
      "documents.read",
      "tools.read",
      "waybills.read",
      "notifications.read",
      "team.read",
      "team.tasks.write"
    ]
  },
  {
    name: "PROJECT_MANAGER",
    permissions: [
      "dashboard.read",
      "warehouses.read",
      "materials.read",
      "stocks.read",
      "limits.read",
      "limits.write",
      "issues.read",
      "issues.approve",
      "documents.read",
      "tools.read",
      "waybills.read",
      "team.read",
      "team.tasks.write"
    ]
  },
  {
    name: "ACCOUNTING",
    permissions: [
      "dashboard.read",
      "audit.read",
      "warehouses.read",
      "materials.read",
      "stocks.read",
      "issues.read",
      "operations.read",
      "documents.read",
      "waybills.read",
      "notifications.read"
    ]
  },
  {
    name: "MANAGEMENT",
    permissions: [
      "dashboard.read",
      "warehouses.read",
      "materials.read",
      "stocks.read",
      "limits.read",
      "issues.read",
      "operations.read",
      "documents.read",
      "tools.read",
      "waybills.read",
      "notifications.read"
    ]
  },
  {
    name: "VIEWER",
    permissions: [
      "dashboard.read",
      "warehouses.read",
      "materials.read",
      "operations.read",
      "stocks.read",
      "issues.read",
      "limits.read",
      "documents.read",
      "tools.read",
      "waybills.read",
      "notifications.read"
    ]
  }
];

export async function seedBaseData() {
  for (const role of defaultRoles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { permissions: role.permissions },
      create: { name: role.name, permissions: role.permissions }
    });
  }

  const adminRole = await prisma.role.findUnique({ where: { name: "ADMIN" } });
  if (!adminRole) {
    throw new Error("ADMIN role missing after seed");
  }

  const passwordHash = await bcrypt.hash(config.adminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { email: config.adminEmail },
    update: {
      fullName: config.adminName,
      passwordHash,
      roleId: adminRole.id
    },
    create: {
      email: config.adminEmail,
      fullName: config.adminName,
      passwordHash,
      roleId: adminRole.id
    }
  });

  for (const title of ["Кладовщик", "Прораб", "Руководитель проекта", "Администратор"]) {
    await prisma.position.upsert({
      where: { name: title },
      update: {},
      create: { name: title }
    });
  }

  const adminPosition = await prisma.position.findUnique({ where: { name: "Администратор" } });
  if (adminPosition) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { positionId: adminPosition.id }
    });
  }

  const [projects, warehouses] = await Promise.all([
    prisma.project.findMany({ select: { id: true } }),
    prisma.warehouse.findMany({ select: { id: true } })
  ]);
  for (const p of projects) {
    for (const w of warehouses) {
      await prisma.projectWarehouse.upsert({
        where: { projectId_warehouseId: { projectId: p.id, warehouseId: w.id } },
        update: {},
        create: { projectId: p.id, warehouseId: w.id }
      });
    }
  }
}
