export const API_URL = import.meta.env.VITE_API_URL || "";

/** Ссылки из API (uploads/...) и data:/http: для аватаров и файлов */
export function resolvePublicFileUrl(url: string | null | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  const u = url.trim();
  if (/^(https?:|data:|blob:)/i.test(u)) return u;
  const base = API_URL.replace(/\/+$/, "");
  if (!base) return u.startsWith("/") ? u : `/${u}`;
  return `${base}/${u.replace(/^\/+/, "")}`;
}
export const TOKEN_KEY = "skladpro_token";
export const STOCK_VIEW_KEY = "skladpro_stock_view";
export const ISSUE_FILTER_KEY = "skladpro_issue_filter";
export const LIST_VIEW_KEY = "skladpro_list_view";

/** Режим просмотра данных по всем доступным объектам (без привязки к одному складу в шапке). */
export const ALL_OBJECTS_ID = "__ALL__";
