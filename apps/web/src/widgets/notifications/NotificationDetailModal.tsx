import { useEffect, useState } from "react";
import type { NotificationRow } from "../integrations/NotificationsTable";

type AuditSnippet = {
  id: string;
  action: string;
  actionLabel: string;
  summary?: string | null;
  createdAt: string;
  user?: { id?: string; email: string; fullName: string };
  beforeData?: unknown;
  afterData?: unknown;
};

type DocRow = {
  id: string;
  type: string;
  fileName: string;
  filePath: string;
  createdAt: string;
};

type DetailPayload = {
  notification: NotificationRow & { eventCode?: string | null };
  eventLabel?: string;
  auditLogs: AuditSnippet[];
  documents: DocRow[];
};

type Props = {
  notificationId: string;
  apiUrl: string;
  token: string;
  fetchWithSession: typeof fetch;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onOpenLinked: (n: NotificationRow) => void;
  onOpenDocuments?: (entityType: string, entityId: string) => void;
};

function docTypeLabel(type: string): string {
  const map: Record<string, string> = {
    upd: "УПД",
    tn: "ТН",
    "upd-scan": "Скан УПД / ТН",
    "receipt-request": "Заявка Excel",
    photo: "Фото",
    act: "Акт",
    other: "Прочее"
  };
  return map[type] || type;
}

function repairUploadedFileName(fileName: string): string {
  const raw = fileName.trim();
  if (!raw) return "Документ";
  try {
    const bytes = new Uint8Array([...raw].map((ch) => ch.charCodeAt(0) & 0xff));
    const fixed = new TextDecoder("utf-8").decode(bytes);
    if (fixed && !fixed.includes("\uFFFD") && !/[ÃÐ][\u00C0-\u00FF]/.test(fixed)) {
      return fixed.trim();
    }
  } catch {
    // ignore
  }
  if (/[ÃÐ]/.test(raw)) {
    return `${docTypeLabel("other")} · файл`;
  }
  return raw;
}

function levelLabel(level: NotificationRow["level"]): string {
  return ({ INFO: "Инфо", WARNING: "Предупреждение", ERROR: "Ошибка" })[level] ?? level;
}

export function NotificationDetailModal(props: Props) {
  const { notificationId, apiUrl, token, fetchWithSession, onClose, onMarkRead, onOpenLinked, onOpenDocuments } =
    props;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DetailPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await fetchWithSession(`${apiUrl}/api/notifications/${notificationId}/detail`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          if (!cancelled) setError("Не удалось загрузить детали события");
          return;
        }
        const data = (await res.json()) as DetailPayload;
        if (!cancelled) setDetail(data);
      } catch {
        if (!cancelled) setError("Ошибка сети");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, fetchWithSession, notificationId, token]);

  const n = detail?.notification;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="requestMaterialsModalBackdrop"
      onClick={onClose}
    >
      <div className="card requestMaterialsModalCard" onClick={(e) => e.stopPropagation()}>
        <div className="requestMaterialsModalHead">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>{n?.title || "Событие"}</h3>
            {n ? (
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                {new Date(n.createdAt).toLocaleString("ru-RU")} · {levelLabel(n.level)}
                {detail?.eventLabel ? ` · ${detail.eventLabel}` : ""}
                {n.eventCode ? ` (${n.eventCode})` : ""}
              </p>
            ) : null}
          </div>
          <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
            {n && !n.isRead ? (
              <button
                type="button"
                className="ghostBtn"
                onClick={() => {
                  void onMarkRead(n.id);
                  setDetail((prev) =>
                    prev
                      ? { ...prev, notification: { ...prev.notification, isRead: true } }
                      : prev
                  );
                }}
              >
                Прочитано
              </button>
            ) : null}
            {n?.entityType && n.entityId ? (
              <>
                <button type="button" className="ghostBtn" onClick={() => onOpenLinked(n)}>
                  Открыть объект
                </button>
                {onOpenDocuments ? (
                  <button
                    type="button"
                    className="ghostBtn"
                    onClick={() => onOpenDocuments(n.entityType!, n.entityId!)}
                  >
                    Все документы
                  </button>
                ) : null}
              </>
            ) : null}
            <button type="button" className="ghostBtn" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>

        <div className="requestMaterialsModalBody">
          {loading ? <p className="muted">Загрузка…</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {!loading && n ? (
            <>
              <p style={{ marginTop: 0 }}>{n.message}</p>

              <section className="requestMaterialsDocs">
                <div className="requestMaterialsDocsHead">
                  <h4 style={{ margin: 0 }}>Кто и что сделал</h4>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {detail?.auditLogs.length ? `${detail.auditLogs.length} записей` : "нет записей в журнале"}
                  </span>
                </div>
                {detail?.auditLogs.length ? (
                  <ul className="requestMaterialsDocsList">
                    {detail.auditLogs.map((log) => (
                      <li key={log.id}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <strong>{log.actionLabel}</strong>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {log.user?.fullName || "Система"}
                            {log.user?.email ? ` · ${log.user.email}` : ""}
                            {" · "}
                            {new Date(log.createdAt).toLocaleString("ru-RU")}
                          </div>
                          {log.summary ? (
                            <div style={{ fontSize: 13, marginTop: 4 }}>{log.summary}</div>
                          ) : null}
                          {Boolean(log.beforeData || log.afterData) ? (
                            <details style={{ marginTop: 6 }}>
                              <summary className="muted" style={{ fontSize: 11, cursor: "pointer" }}>
                                Подробности (JSON)
                              </summary>
                              <pre
                                className="plainList"
                                style={{
                                  whiteSpace: "pre-wrap",
                                  fontSize: 11,
                                  maxHeight: 160,
                                  overflow: "auto",
                                  margin: "4px 0 0"
                                }}
                              >
                                {JSON.stringify(
                                  { before: log.beforeData, after: log.afterData },
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ margin: "8px 0 0" }}>
                    Для этого уведомления в журнале действий записей не найдено.
                  </p>
                )}
              </section>

              <section className="requestMaterialsDocs">
                <div className="requestMaterialsDocsHead">
                  <h4 style={{ margin: 0 }}>Документы</h4>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {detail?.documents.length ? `${detail.documents.length} файл(ов)` : "нет файлов"}
                  </span>
                </div>
                {detail?.documents.length ? (
                  <ul className="requestMaterialsDocsList">
                    {detail.documents.map((d) => (
                      <li key={d.id}>
                        <a
                          href={`${apiUrl}/${d.filePath}`}
                          target="_blank"
                          rel="noreferrer"
                          className="requestMaterialsDocLink"
                        >
                          <span className="requestMaterialsDocName" title={d.fileName}>
                            {repairUploadedFileName(d.fileName)}
                          </span>
                          <span className="badge neutral">{docTypeLabel(d.type)}</span>
                        </a>
                        <span className="muted requestMaterialsDocDate">
                          {new Date(d.createdAt).toLocaleString("ru-RU")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ margin: "8px 0 0" }}>
                    Файлы по этому событию не прикреплены.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
