import { StatusBadge } from "../../shared/ui/StatusBadge";
import { formatMaterialQty } from "../../shared/quantity";
import { MobileCard, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";
import { consumableConditionLabel, type ToolCatalogConsumableLine } from "./toolCatalog";

type Props = {
  lines: ToolCatalogConsumableLine[];
  selectedKey: string | null;
  onOpen: (line: ToolCatalogConsumableLine) => void;
  safeName: (name: string) => string;
};

export function ToolConsumableListTable({ lines, selectedKey, onOpen, safeName }: Props) {
  return (
    <ResponsiveTableShell>
      <div className="erpTableWrap">
        <table className="erpTable desktopTable">
          <thead>
            <tr>
              <th>Категория</th>
              <th>Наименование</th>
              <th style={{ width: 120 }}>Состояние</th>
              <th style={{ width: 88 }}>Кол-во</th>
              <th style={{ width: 56 }}>Ед.</th>
              <th>Объект</th>
              <th style={{ width: 110 }}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const used = line.condition === "USED";
              const active = selectedKey === line.key;
              return (
                <tr
                  key={line.key}
                  className={active ? "rowHighlight" : undefined}
                  style={{ cursor: "pointer" }}
                  onClick={() => onOpen(line)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(line);
                    }
                  }}
                  tabIndex={0}
                >
                  <td>
                    <span className="muted">Расходник</span>
                  </td>
                  <td>
                    <strong>{safeName(line.name)}</strong>
                    {used ? (
                      <span className="muted" style={{ display: "block", fontSize: 12 }}>
                        рекомендуется выдавать в первую очередь
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge tone={used ? "warn" : "ok"}>{consumableConditionLabel(line.condition)}</StatusBadge>
                  </td>
                  <td>
                    <strong className="toolConsumableQtyCell">{formatMaterialQty(line.quantity)}</strong>
                  </td>
                  <td className="muted">{line.unit}</td>
                  <td className="muted">{safeName(line.warehouseName)}</td>
                  <td>
                    <StatusBadge tone="ok">На складе</StatusBadge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mobileCards">
        {lines.map((line) => (
          <MobileCard key={`m-${line.key}`} onClick={() => onOpen(line)}>
            <h4>{safeName(line.name)}</h4>
            <MobileCardField label="Состояние">
              <StatusBadge tone={line.condition === "USED" ? "warn" : "ok"}>
                {consumableConditionLabel(line.condition)}
              </StatusBadge>
            </MobileCardField>
            <MobileCardField label="Кол-во">
              <strong>{formatMaterialQty(line.quantity)}</strong> {line.unit}
            </MobileCardField>
            <MobileCardField label="Объект">{safeName(line.warehouseName)}</MobileCardField>
          </MobileCard>
        ))}
      </div>
    </ResponsiveTableShell>
  );
}
