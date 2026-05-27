import { useEffect, useState } from "react";

type UserRow = { id: string; fullName: string; email: string };

type Props = {
  token: string | null;
  apiUrl: string;
  users: UserRow[];
  fetchWithSession: typeof fetch;
};

export function CriticalRecipientsSettings({ token, apiUrl, users, fetchWithSession }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    void (async () => {
      try {
        const r = await fetchWithSession(`${apiUrl}/api/notifications/settings/critical-recipients`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (r.ok) {
          const data = (await r.json()) as { userIds?: string[] };
          setSelected(new Set(data.userIds || []));
        }
      } catch {
        setMessage("Не удалось загрузить получателей");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, apiUrl, fetchWithSession]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    setMessage("");
    try {
      const r = await fetchWithSession(`${apiUrl}/api/notifications/settings/critical-recipients`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected] })
      });
      if (!r.ok) {
        setMessage("Не удалось сохранить");
        return;
      }
      const data = (await r.json()) as { addedCount?: number };
      setMessage(
        data.addedCount
          ? `Сохранено. Новым получателям (${data.addedCount}) отправлено уведомление.`
          : "Сохранено."
      );
    } catch {
      setMessage("Сбой сети");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
      <h3 style={{ marginTop: 0 }}>Критические уведомления</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Выбранные пользователи получают: приход сверх заявки, списание инструмента, перерасход по лимитам.
        Дубликат приходит в чат от бота «Помощник».
      </p>
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 6,
            maxHeight: 220,
            overflowY: "auto",
            marginBottom: 10
          }}
        >
          {users
            .filter((u) => !u.email.toLowerCase().includes("assistant@skladpro"))
            .map((u) => (
            <label
              key={u.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                padding: "4px 6px",
                borderRadius: 8,
                background: selected.has(u.id) ? "#fff7ed" : "transparent"
              }}
            >
              <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
              <span>
                {u.fullName}
                <span className="muted" style={{ display: "block", fontSize: 11 }}>
                  {u.email}
                </span>
              </span>
            </label>
            ))}
        </div>
      )}
      <button type="button" disabled={saving || loading} onClick={() => void save()}>
        {saving ? "Сохранение…" : "Сохранить получателей"}
      </button>
      {message ? <p className="muted" style={{ marginTop: 8, color: "#b54708" }}>{message}</p> : null}
    </div>
  );
}
