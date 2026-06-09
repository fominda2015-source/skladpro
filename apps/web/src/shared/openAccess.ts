/** Синхронно с API: OPEN_ACCESS_ALL=0 / VITE_OPEN_ACCESS_ALL=0 отключает режим. */
export const OPEN_ACCESS_ALL = import.meta.env.VITE_OPEN_ACCESS_ALL !== "0";

export function isAdminEquivalent(role: string | undefined | null): boolean {
  return OPEN_ACCESS_ALL || role === "ADMIN";
}
