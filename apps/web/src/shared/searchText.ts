/** Проверка вхождения поисковой строки в текст (без учёта регистра). */
export function matchesSearchQuery(text: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return String(text ?? "")
    .toLowerCase()
    .includes(q);
}

/** Совпадение хотя бы с одним из переданных полей. */
export function matchesSearchFields(query: string, ...fields: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) =>
    String(f ?? "")
      .toLowerCase()
      .includes(q)
  );
}
