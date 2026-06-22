/**
 * Временный режим: все авторизованные пользователи видят все вкладки и действия.
 * Отключить позже: OPEN_ACCESS_ALL=0 в .env
 */
export const OPEN_ACCESS_ALL = process.env.OPEN_ACCESS_ALL !== "0";

export function isAdminEquivalent(role: string | undefined | null): boolean {
  return role === "ADMIN";
}

/** Все склады — только ADMIN с * в правах роли (OPEN_ACCESS_ALL не расширяет область данных). */
export function hasGlobalWarehouseAccess(
  role: string | undefined | null,
  permissions: string[]
): boolean {
  return role === "ADMIN" && permissions.includes("*");
}
