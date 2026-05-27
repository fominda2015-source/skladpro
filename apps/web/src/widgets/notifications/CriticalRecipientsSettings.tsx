import { useCallback, useEffect, useState } from "react";

type UserRow = { id: string; fullName: string; email: string; role?: string; position?: string | null };
type RecipientRow = { id: string; fullName: string; email: string };

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  /** Объект из верхней панели — без отдельного переключателя в блоке. */
  warehouseId: string;
  warehouseName?: string;
};

export function CriticalRecipientsSettings({
  token,
  apiUrl,
  fetchWithSession,
  warehouseId,
  warehouseName
}: Props) {
  const [warehouseUsers, setWarehouseUsers] = useState<UserRow[]>([]);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadRecipients = useCallback(
    async (whId: string) => {
      if (!token || !whId) {
        setRecipients([]);
        return;
      }
      setLoadingRecipients(true);
      try {
        const r = await fetchWithSession(
          `${apiUrl}/api/notifications/settings/critical-recipients?warehouseId=${encodeURIComponent(whId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (r.ok) {
          const data = (await r.json()) as { users?: RecipientRow[] };
          setRecipients(data.users || []);
        }
      } catch {
        setMessage("Не удалось загрузить список получателей");
      } finally {
        setLoadingRecipients(false);
      }
    },
    [apiUrl, fetchWithSession, token]
  );

  const loadWarehouseUsers = useCallback(
    async (whId: string) => {
      if (!token || !whId) {
        setWarehouseUsers([]);
        return;
      }
      setLoadingUsers(true);
      try {
        const r = await fetchWithSession(
          `${apiUrl}/api/notifications/settings/critical-recipients/warehouse-users?warehouseId=${encodeURIComponent(whId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (r.ok) {
          setWarehouseUsers((await r.json()) as UserRow[]);
        } else {
          setWarehouseUsers([]);
          setMessage("Не удалось загрузить пользователей объекта");
        }
      } catch {
        setWarehouseUsers([]);
        setMessage("Сбой сети при загрузке пользователей");
      } finally {
        setLoadingUsers(false);
      }
    },
    [apiUrl, fetchWithSession, token]
  );

  const persistRecipients = useCallback(
    async (userIds: string[]) => {
      if (!token || !warehouseId) return false;
      setBusy(true);
      setMessage("");
      try {
        const r = await fetchWithSession(`${apiUrl}/api/notifications/settings/critical-recipients`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ warehouseId, userIds })
        });
        if (!r.ok) {
          setMessage("Не удалось сохранить");
          return false;
        }
        const data = (await r.json()) as { addedCount?: number; users?: RecipientRow[] };
        if (data.users) setRecipients(data.users);
        else await loadRecipients(warehouseId);
        if (data.addedCount) {
          setMessage(`Добавлено. Новым получателям (${data.addedCount}) отправлено уведомление.`);
        } else {
          setMessage("Сохранено.");
        }
        return true;
      } catch {
        setMessage("Сбой сети");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apiUrl, fetchWithSession, loadRecipients, token, warehouseId]
  );

  useEffect(() => {
    setPickUserId("");
    setMessage("");
    if (!warehouseId) {
      setWarehouseUsers([]);
      setRecipients([]);
      return;
    }
    void loadWarehouseUsers(warehouseId);
    void loadRecipients(warehouseId);
  }, [warehouseId, loadWarehouseUsers, loadRecipients]);

  async function addRecipient() {
    if (!pickUserId || !warehouseId) return;
    const u = warehouseUsers.find((x) => x.id === pickUserId);
    if (!u) return;
    if (recipients.some((r) => r.id === u.id)) {
      setMessage("Уже в списке получателей для этого объекта");
      return;
    }
    const nextIds = [...recipients.map((r) => r.id), u.id];
    const ok = await persistRecipients(nextIds);
    if (ok) setPickUserId("");
  }

  async function removeRecipient(id: string) {
    const nextIds = recipients.filter((r) => r.id !== id).map((r) => r.id);
    await persistRecipients(nextIds);
  }

  const availableToAdd = warehouseUsers.filter((u) => !recipients.some((r) => r.id === u.id));

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
      <h3 style={{ marginTop: 0 }}>Критические уведомления</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Получатели для выбранного объекта (панель сверху): приход сверх заявки, списание инструмента, перерасход по
        лимитам. Дубликат — в чат от «Помощник».
      </p>

      {!warehouseId ? (
        <p className="muted">Выберите объект в верхней панели.</p>
      ) : (
        <>
          <p style={{ margin: "0 0 12px", fontSize: 13 }}>
            <strong>Объект:</strong> {warehouseName || warehouseId}
            {loadingRecipients || loadingUsers ? (
              <span className="muted" style={{ marginLeft: 8 }}>
                обновление…
              </span>
            ) : null}
          </p>

          <div className="form" style={{ marginBottom: 12, maxWidth: 520 }}>
            <label>
              Пользователь на объекте
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                <select
                  value={pickUserId}
                  disabled={busy || loadingUsers || !availableToAdd.length}
                  onChange={(e) => setPickUserId(e.target.value)}
                  style={{ flex: "1 1 200px", minWidth: 160 }}
                >
                  <option value="">
                    {loadingUsers
                      ? "Загрузка…"
                      : availableToAdd.length
                        ? "— выберите —"
                        : recipients.length
                          ? "Все пользователи объекта уже добавлены"
                          : "Нет пользователей с доступом к объекту"}
                  </option>
                  {availableToAdd.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                      {u.position ? ` · ${u.position}` : ""}
                      {u.role ? ` (${u.role})` : ""}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={busy || !pickUserId} onClick={() => void addRecipient()}>
                  {busy ? "…" : "Добавить"}
                </button>
              </div>
            </label>
          </div>

          {recipients.length === 0 ? (
            <p className="muted">Получатели для этого объекта пока не назначены.</p>
          ) : (
            <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              {recipients.map((r) => (
                <li key={r.id} style={{ marginBottom: 6 }}>
                  <strong>{r.fullName}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                    {r.email}
                  </span>
                  <button
                    type="button"
                    className="ghostBtn"
                    style={{ marginLeft: 8, fontSize: 12 }}
                    disabled={busy}
                    onClick={() => void removeRecipient(r.id)}
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {message ? <p className="muted" style={{ marginTop: 8, color: "#b54708" }}>{message}</p> : null}
    </div>
  );
}
