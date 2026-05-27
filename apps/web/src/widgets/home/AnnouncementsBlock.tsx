import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, resolvePublicFileUrl } from "../../app/constants";

export type AnnouncementAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  sortOrder: number;
  url: string;
};

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  expiresAt: string | null;
  createdAt: string;
  author?: { id: string; fullName: string } | null;
  attachments?: AnnouncementAttachment[];
};

type Props = {
  token: string | null;
  fetchWithSession: typeof fetch;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type Draft = {
  title: string;
  body: string;
  isPinned: boolean;
  newFiles: File[];
  removeAttachmentIds: string[];
};

const emptyDraft = (): Draft => ({
  title: "",
  body: "",
  isPinned: false,
  newFiles: [],
  removeAttachmentIds: []
});

export function AnnouncementsBlock({ token, fetchWithSession, canCreate, canEdit, canDelete }: Props) {
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetchWithSession(`${API_URL}/api/announcements`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setRows((await res.json()) as AnnouncementRow[]);
    } finally {
      setLoading(false);
    }
  }, [token, fetchWithSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = rows.length > 0 || canCreate;
  if (!visible) return null;

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
    setComposeOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setComposeOpen(true);
  }

  function startEdit(row: AnnouncementRow) {
    setEditingId(row.id);
    setComposeOpen(true);
    setDraft({
      title: row.title,
      body: row.body,
      isPinned: row.isPinned,
      newFiles: [],
      removeAttachmentIds: [],
    });
  }

  function appendFiles(files: FileList | null) {
    if (!files?.length) return;
    setDraft((d) => ({ ...d, newFiles: [...d.newFiles, ...Array.from(files)] }));
  }

  function toggleRemoveAttachment(id: string) {
    setDraft((d) => ({
      ...d,
      removeAttachmentIds: d.removeAttachmentIds.includes(id)
        ? d.removeAttachmentIds.filter((x) => x !== id)
        : [...d.removeAttachmentIds, id]
    }));
  }

  async function submit() {
    if (!token || saving || !draft.title.trim() || !draft.body.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("title", draft.title.trim());
      fd.set("body", draft.body.trim());
      fd.set("isPinned", draft.isPinned ? "true" : "false");
      if (editingId && draft.removeAttachmentIds.length) {
        fd.set("removeAttachmentIds", JSON.stringify(draft.removeAttachmentIds));
      }
      for (const f of draft.newFiles) {
        fd.append("files", f);
      }

      const url = editingId
        ? `${API_URL}/api/announcements/${editingId}`
        : `${API_URL}/api/announcements`;
      const res = await fetchWithSession(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) {
        let msg = "Не удалось сохранить объявление";
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* ignore */
        }
        window.alert(msg);
        return;
      }
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, title: string) {
    if (!token || !canDelete) return;
    if (!window.confirm(`Удалить объявление «${title}»?`)) return;
    const res = await fetchWithSession(`${API_URL}/api/announcements/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      window.alert("Не удалось удалить объявление");
      return;
    }
    if (editingId === id) resetForm();
    await load();
  }

  const editingRow = editingId ? rows.find((r) => r.id === editingId) : null;
  const existingAttachments =
    editingRow?.attachments?.filter((a) => !draft.removeAttachmentIds.includes(a.id)) ?? [];

  return (
    <section className="card homeBlock">
      <header className="homeBlockHead">
        <h3>Объявления</h3>
        {canCreate ? (
          <button
            type="button"
            className="ghostBtn"
            onClick={() => {
              if (composeOpen && !editingId) {
                resetForm();
              } else {
                startCreate();
              }
            }}
          >
            {composeOpen && !editingId ? "Закрыть форму" : "Новое объявление"}
          </button>
        ) : null}
      </header>

      {composeOpen && (canCreate || (canEdit && editingId)) ? (
        <div className="form card announcementForm" style={{ marginBottom: 12 }}>
          <label>
            Заголовок
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </label>
          <label>
            Текст
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              rows={4}
            />
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.isPinned}
              onChange={(e) => setDraft((d) => ({ ...d, isPinned: e.target.checked }))}
            />
            Закрепить вверху списка
          </label>
          <label>
            Изображения
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                appendFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {draft.newFiles.length > 0 ? (
            <ul className="announcementFileList">
              {draft.newFiles.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  {f.name}
                  <button
                    type="button"
                    className="ghostBtn"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        newFiles: d.newFiles.filter((_, j) => j !== i)
                      }))
                    }
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {existingAttachments.length > 0 ? (
            <div className="announcementAttachGrid">
              {existingAttachments.map((a) => {
                const src = resolvePublicFileUrl(a.url);
                return (
                  <figure key={a.id} className="announcementAttachThumb">
                    {src ? <img src={src} alt={a.fileName} loading="lazy" /> : null}
                    <figcaption>
                      <button type="button" className="ghostBtn" onClick={() => toggleRemoveAttachment(a.id)}>
                        Удалить
                      </button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          ) : null}
          <div className="formActions">
            <button
              type="button"
              disabled={saving || !draft.title.trim() || !draft.body.trim()}
              onClick={() => void submit()}
            >
              {editingId ? "Сохранить" : "Опубликовать"}
            </button>
            <button type="button" className="ghostBtn" disabled={saving} onClick={resetForm}>
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Объявлений пока нет.</p>
      ) : (
        <div className="homeInsightGrid">
          {rows.map((a) => (
            <div
              key={a.id}
              className={`homeInsightCard ${a.isPinned ? "accentWarn" : ""}`}
              style={{ alignItems: "flex-start" }}
            >
              <div className="announcementCardHead">
                <span className="homeInsightLabel">
                  {a.isPinned ? "Закреплено · " : ""}
                  {a.title}
                </span>
                {canEdit || canDelete ? (
                  <div className="announcementCardActions">
                    {canEdit ? (
                      <button type="button" className="ghostBtn" onClick={() => startEdit(a)}>
                        Изменить
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button type="button" className="ghostBtn dangerGhost" onClick={() => void remove(a.id, a.title)}>
                        Удалить
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <p className="homeInsightHint" style={{ whiteSpace: "pre-wrap" }}>
                {a.body}
              </p>
              {a.attachments && a.attachments.length > 0 ? (
                <div className="announcementAttachGrid">
                  {a.attachments.map((att) => {
                    const src = resolvePublicFileUrl(att.url);
                    return src ? (
                      <a
                        key={att.id}
                        className="announcementAttachThumb"
                        href={src}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img src={src} alt={att.fileName} loading="lazy" />
                      </a>
                    ) : null;
                  })}
                </div>
              ) : null}
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {new Date(a.createdAt).toLocaleString("ru-RU")}
                {a.author?.fullName ? ` · ${a.author.fullName}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
