/** Имя с кракозябрами: UTF-8 байты, прочитанные как latin1 (типично multer). */
export function looksLikeMojibake(s: string): boolean {
  return /[ÃÐ][\u00C0-\u00FF]/.test(s) || (s.includes("Ð") && /Ð[\u0080-\u00BF]/.test(s));
}

/** Восстановить кириллицу в уже сохранённом имени. */
export function repairStoredFileName(fileName: string): string {
  const raw = String(fileName || "").trim();
  if (!raw || !looksLikeMojibake(raw)) return raw;
  try {
    const decoded = Buffer.from(raw, "latin1").toString("utf8");
    if (decoded && !decoded.includes("\uFFFD") && !looksLikeMojibake(decoded)) {
      return decoded.trim();
    }
  } catch {
    // ignore
  }
  return raw;
}

/** Декодировать originalname из multipart при загрузке. */
export function decodeUploadedOriginalName(name: string): string {
  const raw = String(name || "").trim();
  if (!raw) return raw;
  try {
    const decoded = Buffer.from(raw, "latin1").toString("utf8");
    if (decoded && !decoded.includes("\uFFFD")) {
      if (/[\u0400-\u04FF]/.test(decoded)) return decoded.trim();
      if (!looksLikeMojibake(decoded)) return decoded.trim();
    }
  } catch {
    // ignore
  }
  return repairStoredFileName(raw);
}

export function withRepairedFileName<T extends { fileName: string }>(row: T): T {
  return { ...row, fileName: repairStoredFileName(row.fileName) };
}
