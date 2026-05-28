import { StatusBadge } from "../../shared/ui/StatusBadge";

export type ToolListRow = {
  id: string;
  name: string;
  inventoryNumber: string;
  serialNumber?: string | null;
  qrCode: string;
  status: string;
  calibrationDueAt?: string | null;
  warehouse?: { id: string; name: string } | null;
};

function formatCalibration(due?: string | null) {
  if (!due) return "—";
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ru-RU");
}

type Props = {
  tools: ToolListRow[];
  selectedIds: string[];
  onToggleSelect: (id: string, checked: boolean) => void;
  onOpen: (id: string) => void;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => "ok" | "warn" | "bad" | "neutral";
  safeName: (name: string) => string;
};

export function ToolsListTable({
  tools,
  selectedIds,
  onToggleSelect,
  onOpen,
  statusLabel,
  statusTone,
  safeName
}: Props) {
  return (
    <div className="erpTableWrap">
      <table className="erpTable desktopTable">
        <thead>
          <tr>
            <th style={{ width: 40 }} />
            <th>Наименование</th>
            <th style={{ width: 120 }}>Инв. №</th>
            <th style={{ width: 120 }}>Серийный</th>
              <th>Объект</th>
              <th style={{ width: 100 }}>Поверка</th>
              <th style={{ width: 110 }}>Статус</th>
              <th style={{ width: 88 }}>QR</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => (
            <tr
              key={t.id}
              style={{ cursor: "pointer" }}
              onClick={() => onOpen(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(t.id);
                }
              }}
              tabIndex={0}
            >
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Выбрать ${t.inventoryNumber}`}
                  checked={selectedIds.includes(t.id)}
                  onChange={(e) => onToggleSelect(t.id, e.target.checked)}
                />
              </td>
              <td>
                <strong>{safeName(t.name)}</strong>
              </td>
              <td className="muted">{t.inventoryNumber}</td>
              <td className="muted">{t.serialNumber || "—"}</td>
              <td className="muted">{t.warehouse?.name ? safeName(t.warehouse.name) : "—"}</td>
              <td className="muted" style={{ fontSize: 12 }}>
                {formatCalibration(t.calibrationDueAt)}
              </td>
              <td>
                <StatusBadge tone={statusTone(t.status)}>{statusLabel(t.status)}</StatusBadge>
              </td>
              <td className="muted" style={{ fontSize: 11 }}>
                {t.qrCode}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function toolStatusTone(status: string): "ok" | "warn" | "bad" | "neutral" {
  const s = status.toUpperCase();
  if (s === "IN_STOCK") return "ok";
  if (["ISSUED", "IN_REPAIR"].includes(s)) return "warn";
  if (["DAMAGED", "LOST", "WRITTEN_OFF", "DISPUTED"].includes(s)) return "bad";
  return "neutral";
}
