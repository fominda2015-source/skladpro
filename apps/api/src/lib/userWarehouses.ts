import { hasGlobalWarehouseAccess } from "./openAccess.js";
import { prisma } from "./prisma.js";

const warehouseSelect = { id: true, name: true, address: true, isActive: true } as const;

export async function getAllowedWarehouses(
  userId: string,
  role: string,
  permissions: string[]
) {
  if (hasGlobalWarehouseAccess(role, permissions)) {
    return prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true }
    });
  }
  const [whScopes, secScopes] = await Promise.all([
    prisma.userWarehouseScope.findMany({
      where: { userId },
      select: { warehouse: { select: warehouseSelect } }
    }),
    prisma.userWarehouseSectionScope.findMany({
      where: { userId },
      select: { warehouse: { select: warehouseSelect } }
    })
  ]);
  const byId = new Map<string, { id: string; name: string; address: string | null }>();
  for (const row of [...whScopes, ...secScopes]) {
    const w = row.warehouse;
    if (w?.isActive) {
      byId.set(w.id, { id: w.id, name: w.name, address: w.address });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Режим «все объекты» — только если у пользователя доступ ко всем активным складам. */
export async function canViewAllObjects(userId: string, role: string, permissions: string[]) {
  const totalActive = await prisma.warehouse.count({ where: { isActive: true } });
  if (totalActive <= 1) return false;
  const allowed = await getAllowedWarehouses(userId, role, permissions);
  return allowed.length >= totalActive;
}
