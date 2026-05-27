import { DataTable } from "../../shared/ui/DataTable";

export type NotificationRow = {
  id: string;
  title: string;
  message: string;
  level: "INFO" | "WARNING" | "ERROR";
  isRead: boolean;
  createdAt: string;
  entityType?: string | null;
  entityId?: string | null;
  eventCode?: string | null;
};

export function NotificationsTable({
  notifications,
  onOpenLinked,
  onOpenDetail
}: {
  notifications: NotificationRow[];
  onOpenLinked?: (n: NotificationRow) => void;
  onOpenDetail?: (n: NotificationRow) => void;
}) {
  const levelLabel = (level: NotificationRow["level"]) =>
    ({
      INFO: "Инфо",
      WARNING: "Предупреждение",
      ERROR: "Ошибка"
    })[level] ?? level;

  const headers =
    onOpenLinked || onOpenDetail
      ? ["Время", "Уровень", "Тема", "Сообщение", "Статус", "Действия"]
      : ["Время", "Уровень", "Тема", "Сообщение", "Статус"];

  return (
    <DataTable headers={headers}>
      {notifications.map((n) => (
        <tr
          key={n.id}
          className={onOpenDetail ? "clickableRow" : undefined}
          onClick={onOpenDetail ? () => onOpenDetail(n) : undefined}
        >
          <td>{new Date(n.createdAt).toLocaleString()}</td>
          <td>{levelLabel(n.level)}</td>
          <td>{n.title}</td>
          <td>{n.message}</td>
          <td>{n.isRead ? "Прочитано" : "Новое"}</td>
          {onOpenLinked || onOpenDetail ? (
            <td onClick={(e) => e.stopPropagation()}>
              {onOpenDetail ? (
                <button type="button" className="ghostBtn" onClick={() => onOpenDetail(n)}>
                  Подробнее
                </button>
              ) : null}
              {n.entityType && n.entityId && onOpenLinked ? (
                <button
                  type="button"
                  className="ghostBtn"
                  style={{ marginLeft: onOpenDetail ? 6 : 0 }}
                  onClick={() => onOpenLinked(n)}
                >
                  К объекту
                </button>
              ) : (
                !onOpenDetail ? <span className="muted">—</span> : null
              )}
            </td>
          ) : null}
        </tr>
      ))}
    </DataTable>
  );
}
