import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const PREVIEW_LINES = 140;
const COLLAPSED_VISIBLE = 4;

const emptyDraft = (): Draft => ({
  title: "",
  body: "",
  isPinned: false,
  newFiles: [],
  removeAttachmentIds: []
});

function formatWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const today = now.toDateString() === d.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday = yesterday.toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (today) return `сегодня, ${time}`;
  if (wasYesterday) return `вчера, ${time}`;
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function needsExpand(body: string) {
  return body.trim().length > PREVIEW_LINES || body.split("\n").length > 4;
}

export function HomeAnnouncements({ token, fetchWithSession, canCreate, canEdit, canDelete }: Props) {
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
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

  const pinned = useMemo(() => rows.filter((r) => r.isPinned), [rows]);
  const regular = useMemo(() => rows.filter((r) => !r.isPinned), [rows]);

  const visibleRegular = showAll ? regular : regular.slice(0, COLLAPSED_VISIBLE);
  const hiddenRegularCount = Math.max(0, regular.length - COLLAPSED_VISIBLE);

  const visible = rows.length > 0 || canCreate || loading;
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
      removeAttachmentIds: []
    });
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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

  function renderCard(a: AnnouncementRow) {
    const expanded = expandedIds.has(a.id);
    const long = needsExpand(a.body);
    const canManage = canEdit || canDelete;

    return (
      <article
        key={a.id}
        className={`homeAnnCard ${a.isPinned ? "homeAnnCard--pinned" : ""}`}
      >
        <div className="homeAnnCardTop">
          <div className="homeAnnCardTitleRow">
            {a.isPinned ? (
              <span className="homeAnnPin" title="Закреплено" aria-hidden>
                📌
              </span>
            ) : null}
            <h4 className="homeAnnCardTitle">{a.title}</h4>
          </div>
          {canManage ? (
            <div className="homeAnnCardMenu">
              {canEdit ? (
                <button type="button" className="homeAnnIconBtn" title="Изменить" onClick={() => startEdit(a)}>
                  ✎
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className="homeAnnIconBtn homeAnnIconBtn--danger"
                  title="Удалить"
                  onClick={() => void remove(a.id, a.title)}
                >
                  ×
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={`homeAnnCardBody ${expanded ? "expanded" : "clamped"}`}>{a.body}</div>

        {long ? (
          <button type="button" className="homeAnnExpandBtn" onClick={() => toggleExpanded(a.id)}>
            {expanded ? "Свернуть" : "Читать полностью"}
          </button>
        ) : null}

        {a.attachments && a.attachments.length > 0 ? (
          <div className="homeAnnPhotos">
            {a.attachments.map((att) => {
              const src = resolvePublicFileUrl(att.url);
              return src ? (
                <a key={att.id} className="homeAnnPhoto" href={src} target="_blank" rel="noreferrer">
                  <img src={src} alt={att.fileName} loading="lazy" />
                </a>
              ) : null;
            })}
          </div>
        ) : null}

        <footer className="homeAnnCardMeta muted">
          {formatWhen(a.createdAt)}
          {a.author?.fullName ? ` · ${a.author.fullName}` : ""}
        </footer>
      </article>
    );
  }

  return (
    <section className="homeAnnouncements" aria-label="Объявления">
      <header className="homeAnnHead">
        <div className="homeAnnHeadText">
          <h3 className="homeAnnTitle">Объявления</h3>
          {rows.length > 0 ? <span className="homeAnnCount">{rows.length}</span> : null}
        </div>
        <div className="homeAnnHeadActions">
          {canCreate ? (
            <button
              type="button"
              className={`ghostBtn homeAnnComposeToggle ${composeOpen ? "active" : ""}`}
              onClick={() => {
                if (composeOpen && !editingId) resetForm();
                else startCreate();
              }}
            >
              {composeOpen && !editingId ? "Закрыть" : "+ Новое"}
            </button>
          ) : null}
        </div>
      </header>

      {composeOpen && (canCreate || (canEdit && editingId)) ? (
        <div className="homeAnnCompose">
          <p className="homeAnnComposeLabel">{editingId ? "Редактирование" : "Новое объявление"}</p>
          <input
            className="homeAnnInput"
            placeholder="Заголовок"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <textarea
            className="homeAnnTextarea"
            placeholder="Текст объявления…"
            rows={4}
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          />
          <label className="homeAnnCheck">
            <input
              type="checkbox"
              checked={draft.isPinned}
              onChange={(e) => setDraft((d) => ({ ...d, isPinned: e.target.checked }))}
            />
            Закрепить вверху
          </label>
          <div className="homeAnnComposeFiles">
            <button type="button" className="ghostBtn" onClick={() => fileInputRef.current?.click()}>
              📷 Добавить фото
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="chatHiddenFile"
              onChange={(e) => {
                appendFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {draft.newFiles.length > 0 ? (
              <span className="muted homeAnnFileHint">{draft.newFiles.length} файл(ов)</span>
            ) : null}
          </div>
          {existingAttachments.length > 0 ? (
            <div className="homeAnnPhotos homeAnnPhotos--edit">
              {existingAttachments.map((a) => {
                const src = resolvePublicFileUrl(a.url);
                return (
                  <figure key={a.id} className="homeAnnPhoto homeAnnPhoto--edit">
                    {src ? <img src={src} alt="" /> : null}
                    <button type="button" className="homeAnnPhotoRemove" onClick={() => toggleRemoveAttachment(a.id)}>
                      ×
                    </button>
                  </figure>
                );
              })}
            </div>
          ) : null}
          <div className="homeAnnComposeActions">
            <button
              type="button"
              className="primaryBtn"
              disabled={saving || !draft.title.trim() || !draft.body.trim()}
              onClick={() => void submit()}
            >
              {saving ? "Сохранение…" : editingId ? "Сохранить" : "Опубликовать"}
            </button>
            <button type="button" className="ghostBtn" disabled={saving} onClick={resetForm}>
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="muted homeAnnEmpty">Загрузка объявлений…</p>
      ) : rows.length === 0 ? (
        <p className="muted homeAnnEmpty">Пока нет объявлений{canCreate ? " — нажмите «Новое», чтобы опубликовать" : ""}.</p>
      ) : (
        <div className="homeAnnFeed">
          {pinned.length > 0 ? <div className="homeAnnPinnedGroup">{pinned.map(renderCard)}</div> : null}
          {visibleRegular.length > 0 ? (
            <div className="homeAnnRegularGroup">{visibleRegular.map(renderCard)}</div>
          ) : null}
          {!showAll && hiddenRegularCount > 0 ? (
            <button type="button" className="ghostBtn homeAnnShowMore" onClick={() => setShowAll(true)}>
              Показать ещё {hiddenRegularCount}
            </button>
          ) : null}
          {showAll && regular.length > COLLAPSED_VISIBLE ? (
            <button type="button" className="ghostBtn homeAnnShowMore" onClick={() => setShowAll(false)}>
              Свернуть список
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** @deprecated используйте HomeAnnouncements */
export const AnnouncementsBlock = HomeAnnouncements;
