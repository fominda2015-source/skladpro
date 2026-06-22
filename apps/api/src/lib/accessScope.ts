import type { Response } from "express";
import type { ObjectSection } from "./objectAccess.js";

export type ScopeErrorCode =
  | "FORBIDDEN_WAREHOUSE"
  | "FORBIDDEN_SECTION"
  | "FORBIDDEN_PROJECT"
  | "FORBIDDEN_ALL_OBJECTS";

export function scopeErrorMessage(code: string, section?: ObjectSection): string {
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

export function scopeForbiddenPayload(code: string, section?: ObjectSection) {
  return {
    error: code,
    message: scopeErrorMessage(code, section)
  };
}

export function isScopeForbiddenError(err: unknown): err is Error & { status: number } {
  return (
    err instanceof Error &&
    (err as Error & { status?: number }).status === 403 &&
    /^(FORBIDDEN_|Forbidden)/.test(err.message)
  );
}

export function respondScopeForbidden(res: Response, err: Error, section?: ObjectSection) {
  return res.status(403).json(scopeForbiddenPayload(err.message, section));
}
