export function looksLikeMojibake(s: string): boolean {
  return /[ÃÐ][\u00C0-\u00FF]/.test(s) || (s.includes("Ð") && /Ð[\u0080-\u00BF]/.test(s));
}

/** Multer / БД: UTF-8 имя, прочитанное как latin1 — восстанавливаем кириллицу. */
export function repairUploadedFileName(fileName: string): string {
  const raw = fileName.trim();
  if (!raw) return "";
  if (!looksLikeMojibake(raw)) return raw;
  try {
    const bytes = new Uint8Array([...raw].map((ch) => ch.charCodeAt(0) & 0xff));
    const fixed = new TextDecoder("utf-8").decode(bytes);
    if (fixed && !fixed.includes("\uFFFD") && !looksLikeMojibake(fixed)) {
      return fixed.trim();
    }
  } catch {
    // ignore
  }
  return raw;
}

export function docTypeLabel(type: string): string {
  const map: Record<string, string> = {
    upd: "УПД",
    tn: "ТН",
    invoice: "Счёт",
    "upd-scan": "Скан УПД / ТН",
    "receipt-request": "Заявка Excel",
    photo: "Фото",
    act: "Акт",
    "issue-act": "Акт выдачи",
    "issue-act-tools": "Акт выдачи (инструмент)",
    "issue-signed-attachment": "Подписанный документ",
    other: "Прочее"
  };
  return map[type] || type;
}

export function formatDocMoment(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** Человекочитаемое имя файла для списков и ссылок. */
export function displayDocumentFileName(
  fileName: string,
  opts?: { type?: string; createdAt?: string }
): string {
  const repaired = repairUploadedFileName(fileName);
  if (repaired && !looksLikeMojibake(repaired)) return repaired;
  if (opts?.type && opts.createdAt) {
    return `${docTypeLabel(opts.type)} · ${formatDocMoment(opts.createdAt)}`;
  }
  if (opts?.type) return docTypeLabel(opts.type);
  return "Документ";
}
