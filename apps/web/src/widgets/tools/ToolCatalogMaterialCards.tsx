import { MATERIAL_QTY_STEP, formatMaterialQty } from "../../shared/quantity";
import type { ToolCatalogMaterialRow } from "./toolCatalog";

type ViewProps = {
  mode?: "view";
  rows: ToolCatalogMaterialRow[];
  loading?: boolean;
  onOpen: (row: ToolCatalogMaterialRow) => void;
};

type PickProps = {
  mode: "pick";
  rows: Array<
    ToolCatalogMaterialRow & {
      maxQty: number;
      qty: string;
      onQtyChange: (qty: string) => void;
    }
  >;
  loading?: boolean;
};

type Props = ViewProps | PickProps;

export function ToolCatalogMaterialCards(props: Props) {
  const { loading } = props;
  if (loading) return <p className="muted">Загрузка...</p>;

  if (props.mode === "pick") {
    const { rows } = props;
    if (!rows.length) return null;
    return (
      <div className="toolCatalogMaterialGrid toolCatalogMaterialGrid--pick">
        {rows.map((r) => (
          <article key={r.materialId} className="toolCatalogMaterialCard toolCatalogMaterialCard--pick">
            <div className="toolCatalogMaterialCardBody">
              <span className="toolCatalogMaterialCardIcon" aria-hidden>
                📦
              </span>
              <h4 className="toolCatalogMaterialCardTitle">{r.name}</h4>
              <p className="toolCatalogMaterialCardQty" aria-label={`Новые: ${r.qtyNew}`}>
                {formatMaterialQty(r.qtyNew)}
              </p>
              <p className="toolCatalogMaterialCardQtyHint muted">
                новые · {r.unit}
                {r.qtyUsed > 0 ? ` · б/у ${formatMaterialQty(r.qtyUsed)}` : ""}
              </p>
            </div>
            <label className="toolCatalogMaterialCardPick">
              Выдать
              <input
                type="number"
                min={0}
                max={r.maxQty}
                step={MATERIAL_QTY_STEP}
                value={r.qty}
                onChange={(e) => r.onQtyChange(e.target.value.replace(/[^\d]/g, ""))}
                aria-label={`Количество: ${r.name}`}
              />
            </label>
          </article>
        ))}
      </div>
    );
  }

  const { rows, onOpen } = props;
  if (!rows.length) return <p className="muted">Позиции не найдены.</p>;

  return (
    <div className="toolCatalogMaterialGrid">
      {rows.map((r) => {
        const total = r.qtyNew + r.qtyUsed;
        return (
          <button
            key={`${r.warehouseId}-${r.materialId}-${r.section}`}
            type="button"
            className="toolCatalogMaterialCard"
            onClick={() => onOpen(r)}
          >
            <span className="toolCatalogMaterialCardIcon" aria-hidden>
              📦
            </span>
            <span className="toolCatalogMaterialCardTitle">{r.name}</span>
            <span className="toolCatalogMaterialCardQty">{formatMaterialQty(total > 0 ? total : r.qtyNew)}</span>
            <span className="toolCatalogMaterialCardQtyHint muted">
              {r.qtyUsed > 0
                ? `новые ${formatMaterialQty(r.qtyNew)} · б/у ${formatMaterialQty(r.qtyUsed)}`
                : `новые · ${r.unit}`}
            </span>
            <span className="toolCatalogMaterialCardMeta muted">{r.warehouseName}</span>
          </button>
        );
      })}
    </div>
  );
}