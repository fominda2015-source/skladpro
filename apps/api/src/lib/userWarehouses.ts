import { prisma } from "./prisma.js";

export async function getAllowedWarehouses(userId: string, permissions: string[]) {
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
  return scopes.map((x) => x.warehouse).filter((w) => w);
}

/** Режим «все объекты» — только если у пользователя доступ ко всем активным складам. */
export async function canViewAllObjects(userId: string, permissions: string[]) {
  const totalActive = await prisma.warehouse.count({ where: { isActive: true } });
  if (totalActive <= 1) return false;
  const allowed = await getAllowedWarehouses(userId, permissions);
  return allowed.length >= totalActive;
}
