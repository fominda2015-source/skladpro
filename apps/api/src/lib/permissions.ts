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
  if (permissions.includes("*")) return true;
  if (permissions.includes(needed)) return true;
  if (needed === "documents.upload" && permissions.includes("documents.write")) return true;
  if (needed === "dashboard.read" && permissions.includes("stocks.read")) return true;
  if (needed === "materials.match" && permissions.includes("materials.write")) return true;
  return false;
}
