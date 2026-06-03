/** URL экспорта: при пустом apiUrl (nginx, same-origin) — относительный путь для fetch. */
export function buildExportApiUrl(apiUrl: string, section: string): URL {
  const path = `/api/exports/${section}.xlsx`;
  const base = apiUrl.replace(/\/+$/, "");
  if (base) {
    return new URL(path, `${base}/`);
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(path, window.location.origin);
  }
  return new URL(`http://127.0.0.1${path}`);
}

/** Скачивание .xlsx из API с разбором ошибок, таймаутом и прогрессом. */
export type ExportProgressState = {
  phase: "waiting" | "downloading" | "saving" | "done";
  percent: number | null;
  elapsedSec: number;
  detail: string;
};

export type ExportProgressCallback = (state: ExportProgressState) => void;

const EXPORT_TIMEOUT_MS = 120_000;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

function parseFileName(disposition: string, fallbackName: string): string {
  let fileName = fallbackName;
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      fileName = decodeURIComponent(star[1]);
    } catch {
      fileName = star[1];
    }
  } else {
    const plain = /filename="([^"]+)"/i.exec(disposition) || /filename=([^;\s]+)/i.exec(disposition);
    if (plain?.[1]) {
      try {
        fileName = decodeURIComponent(plain[1].replace(/^"|"$/g, ""));
      } catch {
        fileName = plain[1].replace(/^"|"$/g, "");
      }
    }
  }
  return fileName;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function downloadExportXlsx(
  fetchWithSession: typeof fetch,
  url: string,
  token: string,
  fallbackName = "export.xlsx",
  onProgress?: ExportProgressCallback
): Promise<{ ok: true } | { ok: false; error: string }> {
  const started = Date.now();
  let waitTimer: ReturnType<typeof setInterval> | undefined;

  const emit = (partial: Omit<ExportProgressState, "elapsedSec"> & { elapsedSec?: number }) => {
    onProgress?.({
      elapsedSec: partial.elapsedSec ?? Math.floor((Date.now() - started) / 1000),
      phase: partial.phase,
      percent: partial.percent,
      detail: partial.detail
    });
  };

  emit({
    phase: "waiting",
    percent: null,
    detail: "Формирование отчёта на сервере…"
  });

  if (onProgress) {
    waitTimer = setInterval(() => {
      emit({
        phase: "waiting",
        percent: null,
        detail: "Формирование отчёта на сервере…"
      });
    }, 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);

  try {
    const r = await fetchWithSession(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });

    if (waitTimer) clearInterval(waitTimer);

    const contentType = r.headers.get("Content-Type") || "";

    if (!r.ok) {
      if (contentType.includes("application/json")) {
        try {
          const j = (await r.json()) as { error?: string };
          return { ok: false, error: j.error || `Ошибка ${r.status}` };
        } catch {
          // ignore
        }
      }
      const text = await r.text().catch(() => "");
      return { ok: false, error: text || `Ошибка ${r.status}` };
    }

    if (
      contentType.includes("text/html") ||
      (!contentType.includes("spreadsheet") && !contentType.includes("octet-stream"))
    ) {
      const snippet = await r
        .text()
        .then((t) => t.slice(0, 280))
        .catch(() => "");
      if (snippet.startsWith("{")) {
        try {
          const j = JSON.parse(snippet) as { error?: string };
          return { ok: false, error: j.error || "Сервер вернул JSON вместо Excel" };
        } catch {
          // ignore
        }
      }
      if (contentType.includes("text/html") || snippet.includes("<!DOCTYPE") || snippet.includes("<html")) {
        return {
          ok: false,
          error:
            "Сервер вернул HTML вместо Excel. Откройте сайт через основной адрес (nginx) и пересоберите api/web."
        };
      }
      return { ok: false, error: "Ответ не похож на файл Excel" };
    }

    const total = Number(r.headers.get("Content-Length")) || 0;
    const disposition = r.headers.get("Content-Disposition") || "";
    const fileName = parseFileName(disposition, fallbackName);

    let blob: Blob;

    if (r.body) {
      const reader = r.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const percent =
          total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null;
        emit({
          phase: "downloading",
          percent,
          detail:
            total > 0
              ? `Скачано ${formatBytes(received)} из ${formatBytes(total)}`
              : `Скачано ${formatBytes(received)}`
        });
      }

      blob = new Blob(chunks as BlobPart[], {
        type: contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
    } else {
      emit({ phase: "downloading", percent: null, detail: "Получение файла…" });
      blob = await r.blob();
    }

    if (blob.size < 4) {
      return { ok: false, error: "Пустой файл" };
    }

    emit({ phase: "saving", percent: 100, detail: "Сохранение на устройство…" });
    triggerBlobDownload(blob, fileName);
    emit({ phase: "done", percent: 100, detail: "Готово" });
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") {
      return {
        ok: false,
        error: "Превышено время ожидания (2 мин). Сузьте период, выберите один объект или обратитесь к администратору."
      };
    }
    return { ok: false, error: String(err.message || e) };
  } finally {
    if (waitTimer) clearInterval(waitTimer);
    clearTimeout(timeoutId);
  }
}
