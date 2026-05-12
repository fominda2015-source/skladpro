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
};

export function NotificationsTable({
  notifications,
  onOpenLinked
}: {
  notifications: NotificationRow[];
  onOpenLinked?: (n: NotificationRow) => void;
}) {
  const levelLabel = (level: NotificationRow["level"]) =>
    ({
      INFO: "Инфо",
      WARNING: "Предупреждение",
      ERROR: "Ошибка"
    })[level] ?? level;

  const headers = onOpenLinked
    ? ["Время", "Уровень", "Тема", "Сообщение", "Статус", "Действия"]
    : ["Время", "Уровень", "Тема", "Сообщение", "Статус"];

  return (
    <DataTable headers={headers}>
      {notifications.map((n) => (
        <tr key={n.id}>
          <td>{new Date(n.createdAt).toLocaleString()}</td>
          <td>{levelLabel(n.level)}</td>
          <td>{n.title}</td>
          <td>{n.message}</td>
          <td>{n.isRead ? "Прочитано" : "Новое"}</td>
          {onOpenLinked ? (
            <td>
              {n.entityType && n.entityId ? (
                <button type="button" className="ghostBtn" onClick={() => onOpenLinked(n)}>
                  Открыть
                </button>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          ) : null}
        </tr>
      ))}
    </DataTable>
  );
}
