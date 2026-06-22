import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayDocumentFileName, docTypeLabel } from "../../shared/fileName";

type MaterialDoc = {
  id: string;
  type: string;
  fileName: string;
  filePath: string;
  mimeType?: string | null;
  createdAt: string;
};

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DOC_TYPES = [
  { id: "passport", label: "Паспорт" },
  { id: "certificate", label: "Сертификат" },
  { id: "datasheet", label: "Тех. документация" },
  { id: "photo", label: "Фото" },
  { id: "other", label: "Прочее" }
] as const;

type Props = {
  materialId: string;
  apiUrl: string;
  token: string;
  fetchWithSession: FetchFn;
  canUpload: boolean;
  canDelete: boolean;
};

export function MaterialDocumentsSection({
  materialId,
  apiUrl,
  token,
  fetchWithSession,
  canUpload,
  canDelete
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<MaterialDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]["id"]>("certificate");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [message, setMessage] = useState("");

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ entityType: "material", entityId: materialId });
      const res = await fetchWithSession(`${apiUrl}/api/documents?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setDocs([]);
        setError(res.status === 403 ? "Нет доступа к документам" : "Не удалось загрузить документы");
        return;
      }
      const data = (await res.json()) as MaterialDoc[];
      setDocs(Array.isArray(data) ? data : []);
    } catch {
      setDocs([]);
      setError("Ошибка загрузки документов");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, fetchWithSession, materialId, token]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const sortedDocs = useMemo(
    () => [...docs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [docs]
  );

  async function uploadFile(file: File) {
    if (!canUpload) return;
    setUploading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("entityType", "material");
      formData.append("entityId", materialId);
      formData.append("type", docType);
      formData.append("file", file);
      const res = await fetchWithSession(`${apiUrl}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(typeof err.error === "string" ? err.error : "Не удалось загрузить файл");
        return;
      }
      setMessage("Документ приложен");
      await loadDocs();
    } catch {
      setMessage("Ошибка загрузки");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeDoc(docId: string) {
    if (!canDelete) return;
    if (!window.confirm("Удалить документ из карточки материала?")) return;
    setDeletingId(docId);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/documents/${encodeURIComponent(docId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setMessage("Не удалось удалить документ");
        return;
      }
      setMessage("Документ удалён");
      await loadDocs();
    } catch {
      setMessage("Ошибка удаления");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className="materialCardDocs">
      <div className="materialCardDocsHead">
        <div>
          <h4 style={{ margin: 0 }}>Документы и сертификаты</h4>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            Паспорт, сертификат соответствия, техдокументация — хранятся в карточке материала.
          </p>
        </div>
        {canUpload ? (
          <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
            <select
              value={docType}
              aria-label="Тип документа"
              disabled={uploading}
              onChange={(e) => setDocType(e.target.value as (typeof DOC_TYPES)[number]["id"])}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              ref={inputRef}
              type="file"
              className="srOnly"
              disabled={uploading}
              accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,application/pdf"
              multiple
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                if (!picked.length) return;
                void (async () => {
                  for (const file of picked) {
                    await uploadFile(file);
                  }
                })();
              }}
            />
            <button
              type="button"
              className="secondaryBtn"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Загрузка…" : "Приложить файл"}
            </button>
          </div>
        ) : null}
      </div>

      {message ? <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>{message}</p> : null}
      {error ? <p className="error" style={{ margin: "8px 0 0" }}>{error}</p> : null}

      {loading ? (
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Загрузка списка…
        </p>
      ) : sortedDocs.length ? (
        <ul className="materialCardDocsList">
          {sortedDocs.map((d) => {
            const title = displayDocumentFileName(d.fileName, { type: d.type, createdAt: d.createdAt });
            return (
              <li key={d.id} className="materialCardDocsItem">
                <a
                  href={`${apiUrl}/${d.filePath}`}
                  target="_blank"
                  rel="noreferrer"
                  className="materialCardDocsLink"
                  download={title}
                >
                  <span className="materialCardDocsName" title={title}>
                    {title}
                  </span>
                  <span className="badge neutral">{docTypeLabel(d.type)}</span>
                </a>
                <span className="muted materialCardDocsDate">
                  {new Date(d.createdAt).toLocaleString("ru-RU")}
                </span>
                {canDelete ? (
                  <button
                    type="button"
                    className="ghostBtn"
                    disabled={deletingId === d.id}
                    onClick={() => void removeDoc(d.id)}
                  >
                    {deletingId === d.id ? "…" : "Удалить"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : !error ? (
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Документов пока нет.{canUpload ? " Нажмите «Приложить файл»." : ""}
        </p>
      ) : null}
    </section>
  );
}
