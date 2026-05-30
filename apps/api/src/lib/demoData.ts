import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

/** Маркер тестового объекта — по нему можно безопасно удалить sandbox-данные. */
export const DEMO_WAREHOUSE_PREFIX = "[Тест] ";
export const DEMO_EMAIL_DOMAIN = "@demo.skladpro.local";
export const DEMO_PASSWORD = "demo1234";

const DEMO_USER_SPECS = [
  { role: "STOREKEEPER", fullName: "Тест Кладовщик", email: `demo-storekeeper${DEMO_EMAIL_DOMAIN}` },
  { role: "FOREMAN", fullName: "Тест Прораб", email: `demo-foreman${DEMO_EMAIL_DOMAIN}` },
  { role: "WAREHOUSE_MANAGER", fullName: "Тест Завсклад", email: `demo-manager${DEMO_EMAIL_DOMAIN}` },
  { role: "CHIEF_WAREHOUSE", fullName: "Тест Главный кладовщик", email: `demo-chief${DEMO_EMAIL_DOMAIN}` },
  { role: "VIEWER", fullName: "Тест Наблюдатель", email: `demo-viewer${DEMO_EMAIL_DOMAIN}` }
] as const;

export function isDemoEmail(email: string) {
  return email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);
}

export function isDemoWarehouseName(name: string) {
  return name.trim().startsWith(DEMO_WAREHOUSE_PREFIX);
}

export async function getDemoDataStatus() {
  const warehouse = await prisma.warehouse.findFirst({
    where: { name: { startsWith: DEMO_WAREHOUSE_PREFIX } },
    select: { id: true, name: true, address: true }
  });
  const users = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_EMAIL_DOMAIN } },
    include: { role: true },
    orderBy: { email: "asc" }
  });
  return {
    ready: Boolean(warehouse && users.length > 0),
    warehouse,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role.name
    })),
    password: DEMO_PASSWORD
  };
}

export async function createDemoData() {
  const status = await getDemoDataStatus();
  if (status.ready) {
    return { created: false as const, ...status };
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const roleByName = new Map(roles.map((r) => [r.name, r.id]));

  await prisma.$transaction(async (tx) => {
    let warehouse = await tx.warehouse.findFirst({
      where: { name: { startsWith: DEMO_WAREHOUSE_PREFIX } }
    });
    if (!warehouse) {
      warehouse = await tx.warehouse.create({
        data: {
          name: `${DEMO_WAREHOUSE_PREFIX}Объект проверки`,
          address: "Изолированный объект для ручного тестирования (не используется в отчётах)",
          isActive: true
        }
      });
    }

    for (const spec of DEMO_USER_SPECS) {
      const roleId = roleByName.get(spec.role);
      if (!roleId) continue;

      const exists = await tx.user.findUnique({ where: { email: spec.email } });
      if (exists) continue;

      const user = await tx.user.create({
        data: {
          email: spec.email,
          fullName: spec.fullName,
          roleId,
          passwordHash,
          activeWarehouseId: warehouse.id,
          activeSection: "SS"
        }
      });

      await tx.userWarehouseScope.create({
        data: { userId: user.id, warehouseId: warehouse.id }
      });
      await tx.userWarehouseSectionScope.createMany({
        data: [
          { userId: user.id, warehouseId: warehouse.id, section: "SS" },
          { userId: user.id, warehouseId: warehouse.id, section: "EOM" }
        ],
        skipDuplicates: true
      });
    }
  });

  const next = await getDemoDataStatus();
  return { created: true as const, ...next };
}

export async function deleteDemoData(opts?: { force?: boolean }) {
  const force = Boolean(opts?.force);
  const users = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_EMAIL_DOMAIN } },
    select: { id: true, email: true, fullName: true }
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { name: { startsWith: DEMO_WAREHOUSE_PREFIX } },
    select: { id: true, name: true }
  });

  const skippedUsers: string[] = [];
  for (const user of users) {
    const refs =
      (await prisma.issueRequest.count({ where: { requestedById: user.id } })) +
      (await prisma.auditLog.count({ where: { userId: user.id } }));
    if (refs > 0 && !force) {
      skippedUsers.push(user.email);
      continue;
    }
    await prisma.userWarehouseScope.deleteMany({ where: { userId: user.id } });
    await prisma.userWarehouseSectionScope.deleteMany({ where: { userId: user.id } });
    await prisma.userProjectScope.deleteMany({ where: { userId: user.id } });
    await prisma.user.updateMany({
      where: { id: user.id },
      data: { activeWarehouseId: null, activeSection: null }
    });
    if (refs > 0 && force) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {
        skippedUsers.push(user.email);
      });
    } else if (refs === 0) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {
        skippedUsers.push(user.email);
      });
    }
  }

  let deletedWarehouses = 0;
  for (const wh of warehouses) {
    const hasData =
      (await prisma.operation.count({ where: { warehouseId: wh.id } })) +
      (await prisma.tool.count({ where: { warehouseId: wh.id } })) +
      (await prisma.issueRequest.count({ where: { warehouseId: wh.id } }));
    if (hasData > 0 && !force) continue;
    await prisma.user.updateMany({
      where: { activeWarehouseId: wh.id },
      data: { activeWarehouseId: null, activeSection: null }
    });
    if (hasData > 0 && force) {
      await prisma.tool.deleteMany({ where: { warehouseId: wh.id } });
      await prisma.operation.deleteMany({ where: { warehouseId: wh.id } });
      await prisma.issueRequest.deleteMany({ where: { warehouseId: wh.id } });
    }
    const ok = await prisma.warehouse.delete({ where: { id: wh.id } }).then(() => true).catch(() => false);
    if (ok) deletedWarehouses += 1;
  }

  return {
    deletedUsers: users.length - skippedUsers.length,
    deletedWarehouses,
    skippedUsers
  };
}
