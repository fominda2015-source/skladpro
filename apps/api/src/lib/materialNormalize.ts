/** Нормализация названий ТМЦ для сопоставления (ТЗ: схлопывание номенклатуры). */
export function normalizeMaterialName(name: string): string {
  let s = name.toLowerCase().trim().replace(/\s+/g, " ");
  s = s.replace(/х/g, "x").replace(/×/g, "x").replace(/\*/g, "x");
  s = s.replace(/мм/g, "mm");
  s = s.replace(/ø|⌀|ф/g, "d");
  s = s.replace(/diameter|диаметр/g, "d");
  s = s.replace(/[^a-zа-яё0-9x.\s-]/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function tokenizeNormalized(norm: string): string[] {
  return norm.split(/[\s.-]+/).filter((t) => t.length > 0);
}

export function jaccardTokens(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
