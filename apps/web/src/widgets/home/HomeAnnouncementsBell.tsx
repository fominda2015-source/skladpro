import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../../app/constants";
import { HomeAnnouncements } from "./HomeAnnouncements";
import { HomeDrillModal } from "./HomeDrillModal";

const READ_STORAGE_KEY = "skladpro_ann_read_ids_v1";

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* ignore quota */
  }
}

type Props = {
  token: string | null;
  fetchWithSession: typeof fetch;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export function HomeAnnouncementsBell({ token, fetchWithSession, canCreate, canEdit, canDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [announcementIds, setAnnouncementIds] = useState<string[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds());

  const refreshCount = useCallback(async () => {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/announcements`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const rows = (await res.json()) as Array<{ id: string }>;
    setAnnouncementIds(rows.map((r) => r.id));
  }, [token, fetchWithSession]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const unreadCount = useMemo(
    () => announcementIds.filter((id) => !readIds.has(id)).length,
    [announcementIds, readIds]
  );

  function handleOpen() {
    setOpen(true);
    void refreshCount().then(async () => {
      if (!token) return;
      const res = await fetchWithSession(`${API_URL}/api/announcements`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{ id: string }>;
      setReadIds((prev) => {
        const next = new Set(prev);
        for (const r of rows) next.add(r.id);
        saveReadIds(next);
        return next;
      });
    });
  }

  if (!token) return null;

  const showBadge = unreadCount > 0;

  return (
    <>
      <button
        type="button"
        className="ghostBtn homeAnnBellBtn"
        onClick={handleOpen}
        title={showBadge ? `Непрочитанных: ${unreadCount}` : "Объявления"}
      >
        <span className="homeAnnBellIcon" aria-hidden>
          🔔
        </span>
        Объявления
        {showBadge ? (
          <span className="homeAnnBellBadge" aria-label={`Непрочитано: ${unreadCount}`}>
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <HomeDrillModal
          title="Объявления"
          subtitle="Все уведомления для чтения"
          onClose={() => {
            setOpen(false);
            void refreshCount();
          }}
        >
          <div className="homeAnnModalBody">
            <HomeAnnouncements
              token={token}
              fetchWithSession={fetchWithSession}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              embedded
            />
          </div>
        </HomeDrillModal>
      ) : null}
    </>
  );
}
