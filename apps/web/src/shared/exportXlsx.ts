/** Скачивание .xlsx из API с разбором ошибок и имени файла. */
export async function downloadExportXlsx(
  fetchWithSession: typeof fetch,
  url: string,
  token: string,
  fallbackName = "export.xlsx"
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetchWithSession(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
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
    if (!contentType.includes("spreadsheet") && !contentType.includes("octet-stream")) {
      const text = await r.text().catch(() => "");
      if (text.startsWith("{")) {
        try {
          const j = JSON.parse(text) as { error?: string };
          return { ok: false, error: j.error || "Сервер вернул JSON вместо Excel" };
        } catch {
          // ignore
        }
      }
      return { ok: false, error: "Ответ не похож на файл Excel" };
    }
    const blob = await r.blob();
    if (blob.size < 4) {
      return { ok: false, error: "Пустой файл" };
    }
    const disposition = r.headers.get("Content-Disposition") || "";
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  }
}
