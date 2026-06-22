/** UI-прав по ролям отключены — доступ только через участие в объектах. */
export const OPEN_ACCESS_ALL = false;

export function isAdminEquivalent(role: string | undefined | null): boolean {
  return role === "ADMIN";
}

export function hasGlobalWarehouseAccess(
  role: string | undefined | null,
  permissions: string[]
): boolean {
  return role === "ADMIN" && permissions.includes("*");
}
