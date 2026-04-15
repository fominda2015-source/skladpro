import { normalizePermissions } from "./permissions.js";

export function getEffectivePermissions(rolePermissions: unknown, customPermissions: unknown): string[] {
  const custom = normalizePermissions(customPermissions);
  if (custom.length) return custom;
  return normalizePermissions(rolePermissions);
}
