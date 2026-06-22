export type ObjectSection = "SS" | "EOM";

export type ScopeErrorCode =
  | "FORBIDDEN_WAREHOUSE"
  | "FORBIDDEN_SECTION"
  | "FORBIDDEN_PROJECT"
  | "FORBIDDEN_ALL_OBJECTS"
  | string;

export function scopeErrorMessage(code: ScopeErrorCode, section?: ObjectSection): string {
  switch (code) {
    case "FORBIDDEN_WAREHOUSE":
      return "Нет доступа к этому объекту";
    case "FORBIDDEN_SECTION":
      return section === "EOM"
        ? "Нет доступа к разделу ЭОМ на этом объекте"
        : section === "SS"
          ? "Нет доступа к разделу СС на этом объекте"
          : "Нет доступа к этому разделу на объекте";
    case "FORBIDDEN_PROJECT":
      return "Нет доступа к этому проекту";
    case "FORBIDDEN_ALL_OBJECTS":
      return "Режим «все объекты» недоступен";
    default:
      return "Недостаточно прав";
  }
}

export function readApiErrorMessage(body: unknown, fallback = "Недостаточно прав"): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as { message?: unknown; error?: unknown };
  if (typeof record.message === "string" && record.message.trim()) return record.message;
  if (typeof record.error === "string") return scopeErrorMessage(record.error);
  return fallback;
}

export function pickAllowedSection(
  allowed: ObjectSection[] | null | undefined,
  preferred: ObjectSection
): ObjectSection {
  if (allowed === null || allowed === undefined) return preferred;
  if (!allowed.length) return preferred;
  if (allowed.includes(preferred)) return preferred;
  return allowed[0];
}

export function sectionAllowed(
  allowed: ObjectSection[] | null | undefined,
  section: ObjectSection
): boolean {
  if (allowed === null || allowed === undefined) return true;
  return allowed.includes(section);
}
