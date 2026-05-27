import { useCallback, useEffect, useState } from "react";

type WarehouseRow = { id: string; name: string };
type UserRow = { id: string; fullName: string; email: string; role?: string; position?: string | null };
type RecipientRow = { id: string; fullName: string; email: string };

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
};

export function CriticalRecipientsSettings({ token, apiUrl, fetchWithSession }: Props) {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouseUsers, setWarehouseUsers] = useState<UserRow[]>([]);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [loadingWh, setLoadingWh] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const loadRecipients = useCallback(
    async (whId: string) => {
      if (!token || !whId) {
        setRecipients([]);
        return;
      }
      const r = await fetchWithSession(
        `${apiUrl}/api/notifications/settings/critical-recipients?warehouseId=${encodeURIComponent(whId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.ok) {
        const data = (await r.json()) as { users?: RecipientRow[] };
        setRecipients(data.users || []);
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

  useEffect(() => {
    if (!token) return;
    setLoadingWh(true);
    void (async () => {
      try {
        const r = await fetchWithSession(`${apiUrl}/api/notifications/settings/critical-recipients/warehouses`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (r.ok) {
          const rows = (await r.json()) as WarehouseRow[];
          setWarehouses(rows);
          if (rows.length === 1) setWarehouseId(rows[0]!.id);
        }
      } catch {
        setMessage("Не удалось загрузить список объектов");
      } finally {
        setLoadingWh(false);
      }
    })();
  }, [token, apiUrl, fetchWithSession]);

  useEffect(() => {
    if (!warehouseId) {
      setWarehouseUsers([]);
      setRecipients([]);
      setPickUserId("");
      return;
    }
    setMessage("");
    void loadWarehouseUsers(warehouseId);
    void loadRecipients(warehouseId);
  }, [warehouseId, loadWarehouseUsers, loadRecipients]);

  function addRecipient() {
    if (!pickUserId) return;
    const u = warehouseUsers.find((x) => x.id === pickUserId);
    if (!u) return;
    if (recipients.some((r) => r.id === u.id)) {
      setMessage("Пользователь уже в списке получателей");
      return;
    }
    setRecipients((prev) => [...prev, { id: u.id, fullName: u.fullName, email: u.email }]);
    setPickUserId("");
    setMessage("");
  }

  function removeRecipient(id: string) {
    setRecipients((prev) => prev.filter((r) => r.id !== id));
  }

  async function save() {
    if (!token || !warehouseId) {
      setMessage("Сначала выберите объект");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const r = await fetchWithSession(`${apiUrl}/api/notifications/settings/critical-recipients`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId, userIds: recipients.map((x) => x.id) })
      });
      if (!r.ok) {
        setMessage("Не удалось сохранить");
        return;
      }
      const data = (await r.json()) as { addedCount?: number; users?: RecipientRow[] };
      if (data.users) setRecipients(data.users);
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

  const availableToAdd = warehouseUsers.filter((u) => !recipients.some((r) => r.id === u.id));

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
      <h3 style={{ marginTop: 0 }}>Критические уведомления</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        По каждому объекту назначьте получателей: приход сверх заявки, списание инструмента, перерасход по лимитам.
        Дубликат — в чат от «Помощник».
      </p>

      <div className="form grid2" style={{ alignItems: "end", marginBottom: 12 }}>
        <label>
          Объект
          <select
            value={warehouseId}
            disabled={loadingWh}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">— выберите объект —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {warehouseId ? (
          <label>
            Пользователь на объекте
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <select
                value={pickUserId}
                disabled={loadingUsers || !availableToAdd.length}
                onChange={(e) => setPickUserId(e.target.value)}
                style={{ flex: "1 1 200px", minWidth: 160 }}
              >
                <option value="">
                  {loadingUsers
                    ? "Загрузка…"
                    : availableToAdd.length
                      ? "— выберите —"
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
              <button type="button" disabled={!pickUserId} onClick={addRecipient}>
                Добавить
              </button>
            </div>
          </label>
        ) : null}
      </div>

      {!warehouseId ? (
        <p className="muted">Выберите объект, чтобы увидеть пользователей и назначить получателей.</p>
      ) : recipients.length === 0 ? (
        <p className="muted">Получатели для этого объекта пока не назначены.</p>
      ) : (
        <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
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
                onClick={() => removeRecipient(r.id)}
              >
                Убрать
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" disabled={saving || !warehouseId} onClick={() => void save()}>
        {saving ? "Сохранение…" : "Сохранить для объекта"}
      </button>
      {message ? <p className="muted" style={{ marginTop: 8, color: "#b54708" }}>{message}</p> : null}
    </div>
  );
}
