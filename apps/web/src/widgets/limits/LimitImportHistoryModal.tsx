import { formatMaterialQty } from "../../shared/quantity";
import type { LimitImportDiffView } from "./limitImportDiffUtils";

type Props = {
  currentTitle: string;
  previousTitle: string;
  importDiff: LimitImportDiffView;
  onClose: () => void;
};

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LimitImportHistoryButton(props: {
  importDiff: LimitImportDiffView;
  onClick: () => void;
}) {
  const { importDiff, onClick } = props;
  const total = importDiff.added + importDiff.removed + importDiff.qtyChanged;
  if (total <= 0) return null;
  return (
    <button
      type="button"
      className="limitHistoryBtn ghostBtn"
      title="Изменения по сравнению с предыдущей версией лимита"
      aria-label={`История изменений лимита: ${total}`}
      onClick={onClick}
    >
      <HistoryIcon />
      <span className="limitHistoryBtnCount">{total}</span>
    </button>
  );
}

export function LimitImportHistoryModal({ currentTitle, previousTitle, importDiff, onClose }: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modalCard limitHistoryModal" onClick={(e) => e.stopPropagation()}>
        <div className="limitHistoryModalHead">
          <div>
            <h3 style={{ margin: "0 0 4px" }}>Изменения лимита</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {currentTitle}
              <span style={{ margin: "0 6px" }}>←</span>
              {previousTitle}
            </p>
          </div>
          <button type="button" className="ghostBtn" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="limitImportDiffLegend limitImportDiffLegend--modal" role="status">
          <span className="limitDiffTag limitDiffTag--new">Новые: {importDiff.added}</span>
          <span className="limitDiffTag limitDiffTag--qty">Кол-во изменено: {importDiff.qtyChanged}</span>
          <span className="limitDiffTag limitDiffTag--removed">Удалено из файла: {importDiff.removed}</span>
        </div>

        <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
          Выдача и полосы заполнения переносятся с предыдущей версии лимита.
        </p>

        {importDiff.removedItems.length > 0 ? (
          <section className="limitHistorySection">
            <h4>Удалено в новом лимите</h4>
            <ul className="limitRemovedList">
              {importDiff.removedItems.map((item) => (
                <li key={item.pathKey} className="limitRemovedRow">
                  <span className="limitRemovedLabel">{item.label}</span>
                  <span className="muted">
                    {item.unit || "шт"}
                    {item.plannedQty != null ? ` · план ${formatMaterialQty(item.plannedQty)}` : ""}
                    {item.issuedQty > 0 ? ` · выдано ${formatMaterialQty(item.issuedQty)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {importDiff.qtyChangedItems.length > 0 ? (
          <section className="limitHistorySection">
            <h4>Изменено плановое количество</h4>
            <ul className="limitRemovedList">
              {importDiff.qtyChangedItems.map((item) => (
                <li key={item.nodeId} className="limitRemovedRow">
                  <span className="limitRemovedLabel">{item.label}</span>
                  <span className="muted">
                    {item.unit || "шт"} · план {item.prevPlan != null ? formatMaterialQty(item.prevPlan) : "—"} →{" "}
                    {item.newPlan != null ? formatMaterialQty(item.newPlan) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {importDiff.added > 0 ? (
          <section className="limitHistorySection">
            <h4>Новые позиции</h4>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {importDiff.added} — отмечены зелёной подсветкой в дереве лимита.
            </p>
          </section>
        ) : null}

        <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="primaryBtn" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
