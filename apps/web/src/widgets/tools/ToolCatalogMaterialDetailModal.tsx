import { createPortal } from "react-dom";
import { formatMaterialQty } from "../../shared/quantity";
import { formatMoneyOrDash } from "../../shared/pricing";
import {
  CATALOG_MATERIAL_SECTIONS,
  catalogMaterialSectionLabel,
  type CatalogMaterialSection,
  type LegacyCatalogMaterialSection,
  type ToolCatalogMaterialRow
} from "./toolCatalog";

type Props = {
  row: ToolCatalogMaterialRow;
  currentSection?: CatalogMaterialSection | LegacyCatalogMaterialSection | null;
  canWrite?: boolean;
  busy?: boolean;
  onClose: () => void;
  onChangeSection?: (materialId: string, section: CatalogMaterialSection | null) => void | Promise<void>;
};

export function ToolCatalogMaterialDetailModal({
  row,
  currentSection,
  canWrite,
  busy,
  onClose,
  onChangeSection
}: Props) {
  const moveTargets = CATALOG_MATERIAL_SECTIONS.filter((s) => s.value !== currentSection);
  const total = row.qtyNew + row.qtyUsed;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="modalOverlayCenter"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="card modalCardWide toolCatalogMaterialDetailModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Карточка расходника
            </p>
            <h3 style={{ margin: "4px 0 0" }}>{row.name}</h3>
          </div>
          <button type="button" className="ghostBtn" disabled={busy} onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="toolCatalogMaterialDetailStats">
          <div className="toolCatalogMaterialDetailStat">
            <span className="toolCatalogMaterialDetailStatValue">{formatMaterialQty(total)}</span>
            <span className="muted">всего · {row.unit}</span>
          </div>
          <div className="toolCatalogMaterialDetailStat">
            <span className="toolCatalogMaterialDetailStatValue">{formatMaterialQty(row.qtyNew)}</span>
            <span className="muted">новые</span>
          </div>
          <div className="toolCatalogMaterialDetailStat">
            <span className="toolCatalogMaterialDetailStatValue">
              {row.qtyUsed > 0 ? formatMaterialQty(row.qtyUsed) : "—"}
            </span>
            <span className="muted">б/у</span>
          </div>
        </div>

        <dl className="toolCatalogMaterialDetailMeta">
          <div>
            <dt>Объект</dt>
            <dd>{row.warehouseName}</dd>
          </div>
          <div>
            <dt>Раздел</dt>
            <dd>{row.section}</dd>
          </div>
          <div>
            <dt>Ед. изм.</dt>
            <dd>{row.unit}</dd>
          </div>
          {row.stockAmount != null && Number.isFinite(Number(row.stockAmount)) ? (
            <div>
              <dt>Сумма остатка</dt>
              <dd>{formatMoneyOrDash(row.stockAmount)}</dd>
            </div>
          ) : null}
          {row.lineTotal != null &&
          Number.isFinite(Number(row.lineTotal)) &&
          row.priceBasisQty != null &&
          Number(row.priceBasisQty) > 0 ? (
            <div>
              <dt>Сумма в карточке</dt>
              <dd>
                {formatMoneyOrDash(row.lineTotal)} за {formatMaterialQty(row.priceBasisQty)} {row.unit}
              </dd>
            </div>
          ) : null}
        </dl>

        {canWrite && onChangeSection ? (
          <div className="toolCatalogMaterialDetailActions">
            <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
              Ошибочно попали в раздел? Уберите на склад или перенесите в другой раздел каталога.
            </p>
            <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="ghostBtn"
                disabled={busy}
                onClick={() => void onChangeSection(row.materialId, null)}
              >
                {busy ? "…" : "Убрать из раздела"}
              </button>
              {moveTargets.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className="ghostBtn"
                  disabled={busy}
                  onClick={() => void onChangeSection(row.materialId, s.value)}
                >
                  → {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {currentSection ? (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
            Раздел каталога: {catalogMaterialSectionLabel(currentSection)}
          </p>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
