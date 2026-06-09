/**
 * Временный режим: все авторизованные пользователи видят все вкладки и действия.
 * Отключить позже: OPEN_ACCESS_ALL=0 в .env
 */
export const OPEN_ACCESS_ALL = process.env.OPEN_ACCESS_ALL !== "0";

export function isAdminEquivalent(role: string | undefined | null): boolean {
  return OPEN_ACCESS_ALL || role === "ADMIN";
}
