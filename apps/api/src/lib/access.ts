import { OPEN_ACCESS_ALL } from "./openAccess.js";
import { normalizePermissions } from "./permissions.js";

/** Права только из роли. Индивидуальные customPermissions отключены (давали 403). */
export function getEffectivePermissions(rolePermissions: unknown, _customPermissions?: unknown): string[] {
  void _customPermissions;
  if (OPEN_ACCESS_ALL) return ["*"];
  return normalizePermissions(rolePermissions);
}
