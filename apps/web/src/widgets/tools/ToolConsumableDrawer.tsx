import { createPortal } from "react-dom";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { formatMaterialQty } from "../../shared/quantity";
import { consumableConditionLabel, type ToolCatalogConsumableLine } from "./toolCatalog";

type Props = {
  line: ToolCatalogConsumableLine | null;
  canWrite: boolean;
  onClose: () => void;
  onIssue: () => void;
  safeName: (name: string) => string;
  layout?: "sticky" | "fixed";
};

export function ToolConsumableDrawer({
  line,
  canWrite,
  onClose,
  onIssue,
  safeName,
  layout = "fixed"
}: Props) {
  if (!line) return null;

  const used = line.condition === "USED";
  const drawerClass =
    layout === "sticky"
      ? "detailDrawer detailDrawerTool detailDrawerSticky"
      : "detailDrawer detailDrawerTool";

  return createPortal(
    <aside className={drawerClass}>
      <div className="detailDrawerHeader">
        <h3>{safeName(line.name)}</h3>
        <button type="button" className="ghostBtn" onClick={onClose}>
          Закрыть
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Кол-во <strong className="toolConsumableDrawerQty">{formatMaterialQty(line.quantity)}</strong> {line.unit}
      </p>
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <StatusBadge tone="ok">На складе</StatusBadge>
        <StatusBadge tone={used ? "warn" : "doc"}>{consumableConditionLabel(line.condition)}</StatusBadge>
        <StatusBadge tone="neutral">{line.section}</StatusBadge>
        <StatusBadge tone="neutral">{safeName(line.warehouseName)}</StatusBadge>
      </div>

      {used ? (
        <p className="resultBanner warn" style={{ fontSize: 13 }}>
          Это возвращённые б/у позиции — рекомендуем выдавать их в первую очередь.
        </p>
      ) : null}

      {canWrite && line.quantity > 0 ? (
        <div className="toolbar" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <button type="button" className="primaryBtn" onClick={onIssue}>
            Выдать
          </button>
        </div>
      ) : null}
    </aside>,
    document.body
  );
}
