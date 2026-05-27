import { useEffect, useMemo, useState } from "react";
import { NotificationsTable, type NotificationRow } from "../integrations/NotificationsTable";
import { NotificationDetailModal } from "./NotificationDetailModal";
import { CriticalRecipientsSettings } from "./CriticalRecipientsSettings";

// Минимальный тип события из каталога API.
type NotificationEvent = {
  code: string;
  label: string;
  defaultLevel: "INFO" | "WARNING" | "ERROR";
  group: string;
};
// Минимальный тип правила: что включено и под каким уровнем у конкретного юзера.
type NotificationRule = {
  id?: string;
  userId: string;
  eventCode: string;
  enabled: boolean;
  level?: "INFO" | "WARNING" | "ERROR" | null;
  user?: { id: string; fullName: string; email: string };
};

type Props = {
  token: string | null;
  notifications: NotificationRow[];
  unreadNotificationCount: number;
  loadNotifications: () => Promise<unknown>;
  markNotificationsRead: (ids: string[]) => Promise<unknown>;
  openNotificationLinkedEntity: (n: NotificationRow) => void;
  openDocumentsForEntity?: (entityType: "issue" | "operation" | "receipt", entityId: string) => void;
  canManageRules: boolean;
  users: Array<{ id: string; fullName: string; email: string }>;
  fetchWithSession: typeof fetch;
  apiUrl: string;
};

// Универсальный блок вкладки «Уведомления».
// Сейчас здесь два больших раздела:
//  1) Свежие уведомления текущего пользователя.
//  2) (Для администратора) Управление правилами подписки и порогом «низкого остатка».
// Намеренно изолируем стейт правил/событий внутри компонента, чтобы не раздувать App.tsx.
export function NotificationsTabBlock(props: Props) {
  const {
    token,
    notifications,
    unreadNotificationCount,
    loadNotifications,
    markNotificationsRead,
    openNotificationLinkedEntity,
    openDocumentsForEntity,
    canManageRules,
    users,
    fetchWithSession,
    apiUrl
  } = props;

  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesMessage, setRulesMessage] = useState("");
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [lowStock, setLowStock] = useState<number>(5);
  const [lowStockDraft, setLowStockDraft] = useState<string>("5");
  const [lowStockBusy, setLowStockBusy] = useState(false);
  const [detailNotificationId, setDetailNotificationId] = useState<string | null>(null);
  const [inboxSubTab, setInboxSubTab] = useState<"events" | "rules">("events");

  function mapNotificationDocEntity(
    entityType: string
  ): "issue" | "operation" | "receipt" | null {
    const key = entityType.replace(/\s/g, "").toLowerCase();
    if (key.includes("issue")) return "issue";
    if (key.includes("receipt")) return "receipt";
    if (key === "operation") return "operation";
    return null;
  }

  // События тянем всем — этот эндпойнт открыт.
  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const r = await fetchWithSession(`${apiUrl}/api/notifications/events`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (r.ok) setEvents(await r.json());
      } catch {
        // ignore
      }
    })();
  }, [token, apiUrl, fetchWithSession]);

  // Текущий порог низкого остатка — отображаем всем, редактируем только админу.
  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const r = await fetchWithSession(`${apiUrl}/api/notifications/settings/low-stock`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (r.ok) {
          const data = (await r.json()) as { value: number };
          setLowStock(Number(data.value));
          setLowStockDraft(String(Number(data.value)));
        }
      } catch {
        // ignore
      }
    })();
  }, [token, apiUrl, fetchWithSession]);

  // Правила тянем только если пользователь может ими управлять и выбрал target.
  async function loadRulesFor(userId: string) {
    if (!token || !canManageRules || !userId) return;
    setRulesLoading(true);
    try {
      const r = await fetchWithSession(
        `${apiUrl}/api/notifications/rules?userId=${encodeURIComponent(userId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.ok) setRules(await r.json());
    } catch {
      setRulesMessage("Не удалось загрузить правила");
    } finally {
      setRulesLoading(false);
    }
  }

  useEffect(() => {
    if (!canManageRules) return;
    if (!targetUserId && users.length) setTargetUserId(users[0].id);
  }, [canManageRules, users, targetUserId]);

  useEffect(() => {
    if (targetUserId) void loadRulesFor(targetUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUserId]);

  const groupedEvents = useMemo(() => {
    const map = new Map<string, NotificationEvent[]>();
    for (const e of events) {
      const arr = map.get(e.group) || [];
      arr.push(e);
      map.set(e.group, arr);
    }
    return Array.from(map.entries());
  }, [events]);

  const ruleByCode = useMemo(() => {
    const m = new Map<string, NotificationRule>();
    for (const r of rules) m.set(r.eventCode, r);
    return m;
  }, [rules]);

  async function toggleRule(eventCode: string, nextEnabled: boolean) {
    if (!token || !targetUserId) return;
    const current = ruleByCode.get(eventCode);
    const item = {
      userId: targetUserId,
      eventCode,
      enabled: nextEnabled,
      level: current?.level ?? null
    };
    try {
      const r = await fetchWithSession(`${apiUrl}/api/notifications/rules`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ items: [item] })
      });
      if (!r.ok) {
        setRulesMessage("Не удалось сохранить правило");
        return;
      }
      setRulesMessage("");
      await loadRulesFor(targetUserId);
    } catch {
      setRulesMessage("Сбой сети при сохранении правила");
    }
  }

  async function setRuleLevel(eventCode: string, level: "INFO" | "WARNING" | "ERROR" | "") {
    if (!token || !targetUserId) return;
    const current = ruleByCode.get(eventCode);
    const item = {
      userId: targetUserId,
      eventCode,
      enabled: current?.enabled ?? true,
      level: level || null
    };
    try {
      const r = await fetchWithSession(`${apiUrl}/api/notifications/rules`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ items: [item] })
      });
      if (!r.ok) {
        setRulesMessage("Не удалось сохранить уровень");
        return;
      }
      await loadRulesFor(targetUserId);
    } catch {
      setRulesMessage("Сбой сети при сохранении уровня");
    }
  }

  async function saveLowStock() {
    if (!token) return;
    const v = Number(lowStockDraft);
    if (!Number.isFinite(v) || v < 0) {
      setRulesMessage("Порог должен быть числом ≥ 0");
      return;
    }
    setLowStockBusy(true);
    try {
      const r = await fetchWithSession(`${apiUrl}/api/notifications/settings/low-stock`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ value: v })
      });
      if (r.ok) {
        const data = (await r.json()) as { value: number };
        setLowStock(Number(data.value));
        setLowStockDraft(String(Number(data.value)));
        setRulesMessage("");
      } else {
        setRulesMessage("Не удалось сохранить порог");
      }
    } catch {
      setRulesMessage("Сбой сети при сохранении порога");
    } finally {
      setLowStockBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Уведомления</h2>
      <div className="tabs" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={inboxSubTab === "events" ? "active" : ""}
          onClick={() => setInboxSubTab("events")}
        >
          События
        </button>
        {canManageRules ? (
          <button
            type="button"
            className={inboxSubTab === "rules" ? "active" : ""}
            onClick={() => setInboxSubTab("rules")}
          >
            Правила подписки
          </button>
        ) : null}
      </div>

      {inboxSubTab === "events" ? (
        <>
      <div className="kpiRow" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <div className="kpi">
          <span>Непрочитано</span>
          <strong>{unreadNotificationCount}</strong>
        </div>
        <p className="muted" style={{ margin: "4px 0 0", flex: "1 1 240px", minWidth: 200 }}>
          Клик по строке — подробности: кто сделал, журнал действий и документы. Список обновляется каждые 2 минуты.
        </p>
      </div>
      <div className="toolbar">
        <button type="button" onClick={() => void loadNotifications()}>Обновить</button>
        <button
          type="button"
          onClick={() => void markNotificationsRead(notifications.filter((n) => !n.isRead).map((n) => n.id))}
        >
          Отметить все как прочитанные
        </button>
      </div>
      {notifications.length ? (
        <NotificationsTable
          notifications={notifications}
          onOpenDetail={(n) => {
            setDetailNotificationId(n.id);
            if (!n.isRead) void markNotificationsRead([n.id]);
          }}
          onOpenLinked={openNotificationLinkedEntity}
        />
      ) : (
        <p className="muted">Уведомлений пока нет.</p>
      )}
        </>
      ) : null}

      {inboxSubTab === "rules" && canManageRules ? (
        <div style={{ marginTop: 8 }}>
          <h3 style={{ marginTop: 0 }}>Правила подписки на события</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Кому и какие события приходят. Универсальный порог «низкого остатка» одинаков для всех пользователей.
          </p>

          <div className="form grid2" style={{ alignItems: "end" }}>
            <label>
              Пользователь
              <select value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)}>
                <option value="">— выбери —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.email})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Порог «низкого остатка»
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={lowStockDraft}
                  onChange={(e) => setLowStockDraft(e.target.value)}
                  style={{ maxWidth: 120 }}
                />
                <button type="button" disabled={lowStockBusy} onClick={() => void saveLowStock()}>
                  Сохранить
                </button>
                <span className="muted" style={{ alignSelf: "center" }}>
                  текущий: {lowStock}
                </span>
              </div>
            </label>
          </div>

          {rulesMessage && <p className="muted" style={{ color: "#b54708" }}>{rulesMessage}</p>}

          {rulesLoading ? (
            <p className="muted">Загружаем правила…</p>
          ) : !targetUserId ? (
            <p className="muted">Выбери пользователя, чтобы увидеть его правила.</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              <CriticalRecipientsSettings
                token={token}
                apiUrl={apiUrl}
                users={users}
                fetchWithSession={fetchWithSession}
              />
              {groupedEvents.map(([group, items]) => (
                <div key={group} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{group}</div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: "55%" }}>Событие</th>
                        <th style={{ width: "15%" }}>Включено</th>
                        <th style={{ width: "30%" }}>Уровень</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((e) => {
                        const rule = ruleByCode.get(e.code);
                        const enabled = rule?.enabled ?? false;
                        const level = rule?.level ?? "";
                        return (
                          <tr key={e.code}>
                            <td>
                              <div>{e.label}</div>
                              <div className="muted" style={{ fontSize: 11 }}>{e.code}</div>
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(ev) => void toggleRule(e.code, ev.target.checked)}
                              />
                            </td>
                            <td>
                              <select
                                value={level}
                                onChange={(ev) => void setRuleLevel(e.code, ev.target.value as "INFO" | "WARNING" | "ERROR" | "")}
                              >
                                <option value="">по умолчанию ({e.defaultLevel})</option>
                                <option value="INFO">INFO</option>
                                <option value="WARNING">WARNING</option>
                                <option value="ERROR">ERROR</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {detailNotificationId && token ? (
        <NotificationDetailModal
          notificationId={detailNotificationId}
          apiUrl={apiUrl}
          token={token}
          fetchWithSession={fetchWithSession}
          onClose={() => setDetailNotificationId(null)}
          onMarkRead={(id) => void markNotificationsRead([id])}
          onOpenLinked={(n) => {
            setDetailNotificationId(null);
            openNotificationLinkedEntity(n);
          }}
          onOpenDocuments={
            openDocumentsForEntity
              ? (entityType, entityId) => {
                  const mapped = mapNotificationDocEntity(entityType);
                  if (mapped) {
                    setDetailNotificationId(null);
                    openDocumentsForEntity(mapped, entityId);
                  }
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
