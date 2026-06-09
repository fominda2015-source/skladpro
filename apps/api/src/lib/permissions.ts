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

export function hasPermission(permissions: string[], needed: string) {
  if (OPEN_ACCESS_ALL) return true;
  if (permissions.includes("*")) return true;
  if (permissions.includes(needed)) return true;
  if (needed === "documents.upload" && permissions.includes("documents.write")) return true;
  if (needed === "dashboard.read" && permissions.includes("stocks.read")) return true;
  if (needed === "integrations.read" && permissions.includes("integrations.write")) return true;
  if (needed === "notifications.read" && permissions.includes("notifications.write")) return true;
  if (needed === "limits.edit" && permissions.includes("limits.write")) return true;
  if (needed === "limits.write" && permissions.includes("limits.edit")) return true;
  if (needed === "announcements.edit" && permissions.includes("announcements.write")) return true;
  if (needed === "announcements.delete" && permissions.includes("announcements.write")) return true;
  return false;
}
