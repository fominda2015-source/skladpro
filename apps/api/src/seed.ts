import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma.js";
import { config } from "./config.js";

const defaultRoles = [
  { name: "ADMIN", permissions: ["*"] },
  {
    name: "WAREHOUSE_MANAGER",
    permissions: [
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
      "tools.read",
      "tools.write",
      "waybills.read",
      "waybills.write"
    ]
  },
  {
    name: "VIEWER",
    permissions: ["warehouses.read", "materials.read", "operations.read", "stocks.read", "issues.read", "limits.read", "documents.read", "tools.read", "waybills.read"]
  }
];

export async function seedBaseData() {
  for (const role of defaultRoles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { permissions: role.permissions },
      create: role
    });
  }

  const adminRole = await prisma.role.findUnique({ where: { name: "ADMIN" } });
  if (!adminRole) {
    throw new Error("ADMIN role missing after seed");
  }

  const passwordHash = await bcrypt.hash(config.adminPassword, 10);
  await prisma.user.upsert({
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
}
