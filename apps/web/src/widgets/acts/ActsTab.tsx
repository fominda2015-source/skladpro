import { useCallback, useEffect, useState } from "react";
import { actDownloadUrl } from "./actsManifest";
import { PageHero } from "../ui/PageHero";
import { TabShell } from "../layout/TabShell";
import { EmptyState, ResultBanner } from "../../shared/ui/StateViews";

type ActTemplate = {
  id: string;
  fileName: string;
  label: string;
  description?: string;
};

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  canUpload?: boolean;
};

export function ActsTab({ token, apiUrl, fetchWithSession, canUpload = false }: Props) {
  const [templates, setTemplates] = useState<ActTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/acts/templates`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setMessage("Не удалось загрузить список шаблонов");
        return;
      }
      setTemplates((await res.json()) as ActTemplate[]);
    } catch {
      setMessage("Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl, fetchWithSession]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TabShell className="actsTab">
      <PageHero
        variant="compact"
        icon="▣"
        title="Акты"
        subtitle="Библиотека шаблонов Excel — скачайте и заполните на объекте"
        stats={[
          { label: "Шаблонов", value: templates.length, tone: "neutral" },
          { label: "Формат", value: ".xlsx", tone: "neutral" }
        ]}
        actions={
          <button type="button" className="ghostBtn" onClick={() => void load()} disabled={loading}>
            ↻ Обновить
          </button>
        }
      />

      {canUpload ? (
        <div className="homePanel" style={{ marginBottom: 10 }}>
          <div className="homePanelHead">
            <h3>Загрузить шаблон</h3>
          </div>
          <div className="toolbar" style={{ flexWrap: "wrap" }}>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />
            <button
              type="button"
              className="primaryBtn"
              disabled={!uploadFile}
              onClick={async () => {
                if (!token || !uploadFile) return;
                setMessage("");
                const fd = new FormData();
                fd.append("file", uploadFile);
                const res = await fetchWithSession(`${apiUrl}/api/acts/upload`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                  body: fd
                });
                if (!res.ok) {
                  setMessage("Не удалось загрузить файл");
                  return;
                }
                setMessage(`Загружен: ${uploadFile.name}`);
                setUploadFile(null);
                await load();
              }}
            >
              Загрузить на сервер
            </button>
          </div>
        </div>
      ) : null}

      {message ? <ResultBanner text={message} tone={message.includes("Не удалось") ? "error" : "neutral"} /> : null}

      {!templates.length && !loading ? (
        <EmptyState title="Шаблонов нет" hint="Положите .xlsx в public/acts или загрузите через форму выше." />
      ) : (
        <div className="erpTableWrap">
          <table className="erpTable desktopTable">
            <thead>
              <tr>
                <th>Название</th>
                <th>Файл</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {templates.map((act) => {
                const href = actDownloadUrl(act.fileName, apiUrl);
                return (
                  <tr key={act.id}>
                    <td>
                      <strong>{act.label}</strong>
                      {act.description ? (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {act.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="muted">{act.fileName}</td>
                    <td>
                      <a className="primaryBtn actsDownloadBtn" href={href} download={act.fileName}>
                        Скачать
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TabShell>
  );
}
