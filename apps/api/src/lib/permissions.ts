import { OPEN_ACCESS_ALL } from "./openAccess.js";

export function normalizePermissions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
  }
  return [];
}

/** Проверка UI-прав отключена — доступ к данным только через scope объектов. */
export function hasPermission(_permissions: string[], _needed: string) {
  void _needed;
  if (OPEN_ACCESS_ALL) return true;
  return true;
}
