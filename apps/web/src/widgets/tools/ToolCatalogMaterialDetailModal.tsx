import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatMaterialQty } from "../../shared/quantity";
import { formatMoneyOrDash } from "../../shared/pricing";
import { movementNavLabel, resolveStockMovementNav } from "../../shared/stockMovementNav";
import {
  CATALOG_MATERIAL_SECTIONS,
  catalogMaterialSectionLabel,
  type CatalogMaterialSection,
  type LegacyCatalogMaterialSection,
  type ToolCatalogMaterialRow
} from "./toolCatalog";

type MovementRow = {
  id: string;
  createdAt: string;
  direction: "IN" | "OUT";
  quantity: string;
  sourceDocumentType: string;
  sourceDocumentId?: string | null;
  operationId?: string | null;
  issueRequestId?: string | null;
  operation?: { documentNumber?: string | null } | null;
  issueRequest?: { number?: string } | null;
};

type Props = {
  row: ToolCatalogMaterialRow;
  currentSection?: CatalogMaterialSection | LegacyCatalogMaterialSection | null;
  canWrite?: boolean;
  busy?: boolean;
  token?: string | null;
  apiUrl?: string;
  fetchWithSession?: (url: string, init?: RequestInit) => Promise<Response>;
  onMovementClick?: (movement: MovementRow) => void;
  onClose: () => void;
  onChangeSection?: (materialId: string, section: CatalogMaterialSection | null) => void | Promise<void>;
};

export function ToolCatalogMaterialDetailModal({
  row,
  currentSection,
  canWrite,
  busy,
  token,
  apiUrl,
  fetchWithSession,
  onMovementClick,
  onClose,
  onChangeSection
}: Props) {
  const moveTargets = CATALOG_MATERIAL_SECTIONS.filter((s) => s.value !== currentSection);
  const total = row.qtyNew + row.qtyUsed;
  const unitCost =
    row.lineTotal != null &&
    row.priceBasisQty != null &&
    Number(row.priceBasisQty) > 0 &&
    Number.isFinite(Number(row.lineTotal))
      ? Number(row.lineTotal) / Number(row.priceBasisQty)
      : null;
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  useEffect(() => {
    if (!token || !apiUrl || !fetchWithSession) return;
    let cancelled = false;
    setMovementsLoading(true);
    void (async () => {
      try {
        const q = new URLSearchParams({
          warehouseId: row.warehouseId,
          materialId: row.materialId,
          take: "30"
        });
        const res = await fetchWithSession(`${apiUrl}/api/stock-movements?${q}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok || cancelled) return;
        setMovements((await res.json()) as MovementRow[]);
      } finally {
        if (!cancelled) setMovementsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, apiUrl, fetchWithSession, row.warehouseId, row.materialId]);

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
              Карточка позиции
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
                {unitCost != null && Number.isFinite(unitCost)
                  ? ` · ${unitCost.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽/ед.`
                  : ""}
              </dd>
            </div>
          ) : null}
        </dl>

        {movements.length > 0 || movementsLoading ? (
          <section className="whDetailBlock" style={{ marginTop: 12 }}>
            <h4 style={{ margin: "0 0 8px" }}>Движения</h4>
            {movementsLoading ? <p className="muted">Загрузка…</p> : null}
            {!movementsLoading && movements.length > 0 ? (
              <table className="whSubTable">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Тип</th>
                    <th>Кол-во</th>
                    <th>Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => {
                    const nav = resolveStockMovementNav(m);
                    const label = movementNavLabel(m);
                    return (
                      <tr key={m.id}>
                        <td>{new Date(m.createdAt).toLocaleString("ru-RU")}</td>
                        <td>{m.direction === "IN" ? "Приход" : "Выдача"}</td>
                        <td>{formatMaterialQty(Number(m.quantity))}</td>
                        <td>
                          {nav && onMovementClick ? (
                            <button
                              type="button"
                              className="whLinkBtn"
                              onClick={() => onMovementClick(m)}
                            >
                              {label}
                            </button>
                          ) : (
                            label
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </section>
        ) : null}

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
