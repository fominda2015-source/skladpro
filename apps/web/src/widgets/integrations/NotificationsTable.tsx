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

export function NotificationsTable({ notifications }: { notifications: NotificationRow[] }) {
  const levelLabel = (level: NotificationRow["level"]) =>
    ({
      INFO: "Инфо",
      WARNING: "Предупреждение",
      ERROR: "Ошибка"
    })[level] ?? level;

  return (
    <DataTable headers={["Время", "Уровень", "Тема", "Сообщение", "Статус"]}>
      {notifications.map((n) => (
        <tr key={n.id}>
          <td>{new Date(n.createdAt).toLocaleString()}</td>
          <td>{levelLabel(n.level)}</td>
          <td>{n.title}</td>
          <td>{n.message}</td>
          <td>{n.isRead ? "Прочитано" : "Новое"}</td>
        </tr>
      ))}
    </DataTable>
  );
}
