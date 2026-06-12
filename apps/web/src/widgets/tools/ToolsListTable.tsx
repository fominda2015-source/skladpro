import { StatusBadge } from "../../shared/ui/StatusBadge";
import { MobileCard, MobileCardActions, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

export type ToolListRow = {
  id: string;
  name: string;
  inventoryNumber: string;
  serialNumber?: string | null;
  qrCode: string;
  status: string;
  brand?: string | null;
  toolType?: string | null;
  category?: { id: string; name: string } | null;
  warehouse?: { id: string; name: string } | null;
  purchasePrice?: number | null;
};

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
    <ResponsiveTableShell>
    <div className="erpTableWrap">
      <table className="erpTable desktopTable">
        <thead>
          <tr>
            <th style={{ width: 40 }} />
            <th>Категория</th>
            <th>Наименование</th>
            <th style={{ width: 100 }}>Марка</th>
            <th style={{ width: 100 }}>Вид</th>
            <th style={{ width: 120 }}>Инв. №</th>
            <th style={{ width: 120 }}>Серийный</th>
            <th>Объект</th>
            <th style={{ width: 110 }}>Стоимость</th>
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
                <span className="muted">{t.category?.name || "—"}</span>
              </td>
              <td>
                <strong>{safeName(t.name)}</strong>
              </td>
              <td className="muted">{t.brand || "—"}</td>
              <td className="muted">{t.toolType || "—"}</td>
              <td className="muted">{t.inventoryNumber}</td>
              <td className="muted">{t.serialNumber || "—"}</td>
              <td className="muted">{t.warehouse?.name ? safeName(t.warehouse.name) : "—"}</td>
              <td className="muted">
                {t.purchasePrice != null && Number.isFinite(Number(t.purchasePrice))
                  ? `${Number(t.purchasePrice).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`
                  : "—"}
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
    <div className="mobileCards">
      {tools.map((t) => (
        <MobileCard key={`m-${t.id}`} onClick={() => onOpen(t.id)}>
          <h4>{safeName(t.name)}</h4>
          <MobileCardField label="Инв. №">{t.inventoryNumber}</MobileCardField>
          <MobileCardField label="Категория">{t.category?.name || "—"}</MobileCardField>
          <MobileCardField label="Объект">{t.warehouse?.name ? safeName(t.warehouse.name) : "—"}</MobileCardField>
          <MobileCardField label="Статус">
            <StatusBadge tone={statusTone(t.status)}>{statusLabel(t.status)}</StatusBadge>
          </MobileCardField>
          <MobileCardActions>
            <input
              type="checkbox"
              aria-label={`Выбрать ${t.inventoryNumber}`}
              checked={selectedIds.includes(t.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggleSelect(t.id, e.target.checked)}
            />
            <button type="button" onClick={() => onOpen(t.id)}>Открыть</button>
          </MobileCardActions>
        </MobileCard>
      ))}
    </div>
    </ResponsiveTableShell>
  );
}

export function toolStatusTone(status: string): "ok" | "warn" | "bad" | "neutral" {
  const s = status.toUpperCase();
  if (s === "IN_STOCK") return "ok";
  if (["ISSUED", "IN_REPAIR"].includes(s)) return "warn";
  if (["DAMAGED", "LOST", "WRITTEN_OFF", "DISPUTED"].includes(s)) return "bad";
  return "neutral";
}
