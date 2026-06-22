import { prisma } from "./prisma.js";

export async function getResponsibleWarehouseIds(userId: string): Promise<string[]> {
  const rows = await prisma.warehouse.findMany({
    where: { responsibleUserId: userId, isActive: true },
    select: { id: true }
  });
  return rows.map((r) => r.id);
}

export async function isResponsibleForWarehouse(userId: string, warehouseId: string): Promise<boolean> {
  const row = await prisma.warehouse.findFirst({
    where: { id: warehouseId, responsibleUserId: userId },
    select: { id: true }
  });
  return Boolean(row);
}

export async function assertWarehouseMember(userId: string, warehouseId: string) {
  const scope = await prisma.userWarehouseScope.findFirst({
    where: { userId, warehouseId }
  });
  if (!scope) {
    const err = new Error("FORBIDDEN_WAREHOUSE") as Error & { status: number };
    err.status = 403;
    throw err;
  }
}
