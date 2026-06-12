import { Fragment, useState, type ReactNode } from "react";
import {
  warehouseStockKindTabLabel,
  warehouseStockRowLabel,
  type WarehouseStockKindTab
} from "./warehouseStockCategory";
import { WhFloatingMenu, WhMenuAction } from "./WhFloatingMenu";

export type WarehouseStockRow = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  materialId: string;
  materialName: string;
  materialSku: string | null;
  materialUnit: string;
  materialKind?: "MATERIAL" | "CONSUMABLE" | "WORKWEAR";
  materialCategory?: string | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  priceBasisQty?: number | null;
  unitCost?: number | null;
  stockAmount?: number | null;
  quantity: number;
  reserved: number;
  storageRoom?: string | null;
  storageCell?: string | null;
  available: number;
  isLow: boolean;
};

type UpdFactEntry = { sourceName: string; sourceUnit: string; quantity: number };
type MovementSlice = {
  id: string;
  createdAt: string;
  direction: "IN" | "OUT";
  quantity: string;
  sourceDocumentType: string;
  operation?: { documentNumber?: string | null } | null;
  issueRequest?: { number?: string } | null;
};

type KindTab = WarehouseStockKindTab;

export type WarehouseStockViewProps = {
  sectionLabel: string;
  rows: WarehouseStockRow[];
  totalVisible: number;
  lowCount: number;
  loading: boolean;
  error: string;
  limitHint?: string;
  manualMessage?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  kindTab: KindTab;
  onKindTabChange: (tab: KindTab) => void;
  warehouseFilterId: string;
  onWarehouseFilterChange: (id: string) => void;
  warehouseOptions: Array<{ id: string; name: string }>;
  limitMaterialsOnly: boolean;
  onLimitMaterialsOnlyToggle: () => void;
  onlyAvailable: boolean;
  onOnlyAvailableChange: (v: boolean) => void;
  onlyLow: boolean;
  onOnlyLowChange: (v: boolean) => void;
  onlyFactNames: boolean;
  onOnlyFactNamesChange: (v: boolean) => void;
  showSku: boolean;
  onShowSkuChange: (v: boolean) => void;
  showReserve: boolean;
  onShowReserveChange: (v: boolean) => void;
  showPrice: boolean;
  onShowPriceChange: (v: boolean) => void;
  canWriteOperations: boolean;
  canOpenMaterialCard: boolean;
  canEditMaterialCard?: boolean;
  isAdmin: boolean;
  onAddMaterial: () => void;
  onOpenJournal: () => void;
  exportSlot: ReactNode;
  expandedRowId: string;
  onToggleExpand: (rowId: string) => void;
  onOpenMaterialCard: (materialId: string, warehouseId: string) => void;
  onDeleteMaterial: (materialId: string, materialName: string) => void;
  movementsByKey: Map<string, MovementSlice[]>;
  /** Принятые названия по УПД (только factLabel ≠ номенклатура карточки). */
  updFactsByMaterialId: Map<string, Map<string, UpdFactEntry>>;
  movementsLoading?: boolean;
  movementsError?: string;
};

function fmtQty(n: number, maxFrac = 0): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: maxFrac });
}

function kindTone(row: Pick<WarehouseStockRow, "materialKind" | "materialCategory">): string {
  if ((row.materialKind ?? "MATERIAL") === "CONSUMABLE") return "chip warn";
  if (String(row.materialCategory ?? "").toUpperCase() === "CABLE") return "chip neutral";
  return "chip ok";
}

export function WarehouseStockView(props: WarehouseStockViewProps) {
  const {
    sectionLabel,
    rows,
    totalVisible,
    lowCount,
    loading,
    error,
    limitHint,
    manualMessage,
    search,
    onSearchChange,
    onSearchSubmit,
    kindTab,
    onKindTabChange,
    warehouseFilterId,
    onWarehouseFilterChange,
    warehouseOptions,
    limitMaterialsOnly,
    onLimitMaterialsOnlyToggle,
    onlyAvailable,
    onOnlyAvailableChange,
    onlyLow,
    onOnlyLowChange,
    onlyFactNames,
    onOnlyFactNamesChange,
    showSku,
    onShowSkuChange,
    showReserve,
    onShowReserveChange,
    showPrice,
    onShowPriceChange,
    canWriteOperations,
    canOpenMaterialCard,
    canEditMaterialCard = false,
    isAdmin,
    onAddMaterial,
    onOpenJournal,
    exportSlot,
    expandedRowId,
    onToggleExpand,
    onOpenMaterialCard,
    onDeleteMaterial,
    movementsByKey,
    updFactsByMaterialId,
    movementsLoading,
    movementsError
  } = props;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [headerMenuRect, setHeaderMenuRect] = useState<DOMRect | null>(null);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; rect: DOMRect } | null>(null);

  const activeFilters =
    Number(onlyAvailable) +
    Number(onlyLow) +
    Number(onlyFactNames) +
    Number(showSku) +
    Number(showReserve) +
    Number(showPrice) +
    Number(Boolean(warehouseFilterId));

  return (
    <div className="warehouseStockView">
      <header className="whHeader">
        <div className="whHeaderMain">
          <h2 className="whTitle">Склад</h2>
          <p className="whSubtitle">
            {sectionLabel} · показано {rows.length} из {totalVisible}
            {lowCount > 0 ? (
              <>
                {" "}
                ·{" "}
                <button type="button" className="whLinkBtn" onClick={() => onOnlyLowChange(true)}>
                  низкий остаток: {lowCount}
                </button>
              </>
            ) : null}
          </p>
        </div>
        <div className="whHeaderActions">
          {canWriteOperations ? (
            <button type="button" className="primaryBtn whBtnPrimary whBtnAdd" onClick={onAddMaterial}>
              + Добавить
            </button>
          ) : null}
          <div className="whOverflow">
            <button
              type="button"
              className="ghostBtn whBtnIcon"
              aria-label="Дополнительные действия"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setHeaderMenuRect((prev) => (prev ? null : rect));
                setRowMenu(null);
              }}
            >
              ⋯
            </button>
            {headerMenuRect ? (
              <WhFloatingMenu anchorRect={headerMenuRect} onClose={() => setHeaderMenuRect(null)}>
                <WhMenuAction
                  label="Журнал движений"
                  onActivate={() => {
                    onOpenJournal();
                    setHeaderMenuRect(null);
                  }}
                />
                <div className="whMenuExport" style={{ padding: "4px 6px" }}>
                  {exportSlot}
                </div>
              </WhFloatingMenu>
            ) : null}
          </div>
        </div>
      </header>

      {manualMessage ? (
        <p className="whBanner muted" role="status">
          {manualMessage}
        </p>
      ) : null}

      <div className="whControlBar">
        <div className="whSearchRow">
          <input
            className="whSearchInput"
            placeholder="Поиск: название, SKU, синоним…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearchSubmit();
            }}
          />
          <button type="button" className="ghostBtn whBtnFind" onClick={onSearchSubmit}>
            Найти
          </button>
        </div>
        <div className="whToolbar">
          <div className="whChips" role="tablist" aria-label="Вид номенклатуры">
            {(["ALL", "EQUIPMENT", "CABLE", "CONSUMABLE"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kindTab === k}
                className={`chip ${kindTab === k ? "active" : ""}`}
                onClick={() => onKindTabChange(k)}
              >
                {warehouseStockKindTabLabel(k)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`ghostBtn whFilterToggle ${filtersOpen ? "active" : ""}`}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Фильтры{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </button>
          <button
            type="button"
            className={`chip whLimitChip ${limitMaterialsOnly ? "active" : ""}`}
            onClick={onLimitMaterialsOnlyToggle}
          >
            {limitMaterialsOnly ? "Только лимит" : "Все позиции"}
          </button>
        </div>
      </div>

      {filtersOpen ? (
        <div className="whFiltersPanel">
          <label>
            Склад
            <select value={warehouseFilterId} onChange={(e) => onWarehouseFilterChange(e.target.value)}>
              <option value="">Все склады</option>
              {warehouseOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="whCheck">
            <input type="checkbox" checked={onlyAvailable} onChange={(e) => onOnlyAvailableChange(e.target.checked)} />
            С остатком
          </label>
          <label className="whCheck">
            <input type="checkbox" checked={onlyLow} onChange={(e) => onOnlyLowChange(e.target.checked)} />
            Низкий остаток
          </label>
          <label className="whCheck">
            <input type="checkbox" checked={onlyFactNames} onChange={(e) => onOnlyFactNamesChange(e.target.checked)} />
            С факт. названиями
          </label>
          <span className="whFiltersDivider">Колонки</span>
          <label className="whCheck">
            <input type="checkbox" checked={showSku} onChange={(e) => onShowSkuChange(e.target.checked)} />
            SKU
          </label>
          <label className="whCheck">
            <input type="checkbox" checked={showReserve} onChange={(e) => onShowReserveChange(e.target.checked)} />
            Резерв
          </label>
          <label className="whCheck">
            <input type="checkbox" checked={showPrice} onChange={(e) => onShowPriceChange(e.target.checked)} />
            Сумма
          </label>
        </div>
      ) : null}

      {limitHint ? <p className="muted whHint">{limitHint}</p> : null}

      {loading ? <p className="whState">Загрузка остатков…</p> : null}
      {error ? <p className="error whState">{error}</p> : null}
      {!loading && !error && !rows.length ? (
        <div className="whEmpty card">
          <strong>Ничего не найдено</strong>
          <p className="muted">Измените поиск или снимите фильтры.</p>
        </div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <div className="whTableWrap card">
          <table className="whTable">
            <thead>
              <tr>
                <th className="whColMat">Материал</th>
                <th className="whColNum whHideSm">Доступно</th>
                <th className="whColNum whHideSm">Остаток</th>
                {showReserve ? <th className="whColNum whHideSm">Резерв</th> : null}
                <th className="whColLoc">Место</th>
                <th className="whColNum">Сумма</th>
                <th className="whColAct" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = expandedRowId === row.id;
                const updFactsCount = updFactsByMaterialId.get(row.materialId)?.size || 0;
                const movements = movementsByKey.get(`${row.warehouseId}::${row.materialId}`) || [];
                const colSpan = 6 + (showReserve ? 1 : 0);

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`whRow${row.isLow ? " whRowLow" : ""}${expanded ? " whRowExpanded" : ""}`}
                      onClick={() => onToggleExpand(row.id)}
                    >
                      <td className="whColMat">
                        <div className="whMatCell">
                          <span className={`whAvailMobile ${row.isLow ? "bad" : "ok"}`}>
                            {fmtQty(Number(row.available))} {row.materialUnit}
                          </span>
                          <strong
                            className={`whMatName${canOpenMaterialCard ? " whMatNameClickable" : ""}`}
                            title={row.materialName}
                            onClick={
                              canOpenMaterialCard
                                ? (e) => {
                                    e.stopPropagation();
                                    onOpenMaterialCard(row.materialId, row.warehouseId);
                                  }
                                : undefined
                            }
                            onKeyDown={
                              canOpenMaterialCard
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      onOpenMaterialCard(row.materialId, row.warehouseId);
                                    }
                                  }
                                : undefined
                            }
                            role={canOpenMaterialCard ? "button" : undefined}
                            tabIndex={canOpenMaterialCard ? 0 : undefined}
                          >
                            {row.materialName}
                          </strong>
                          <span className="whMatMeta">
                            <span className={kindTone(row)}>{warehouseStockRowLabel(row)}</span>
                            <span className="muted"> · {row.warehouseName}</span>
                            {showSku && row.materialSku ? (
                              <span className="muted"> · {row.materialSku}</span>
                            ) : null}
                            {updFactsCount > 0 ? (
                              <span className="muted"> · УПД: {updFactsCount}</span>
                            ) : null}
                            <span className="muted whHideMd">
                              {" "}
                              · {[row.storageRoom, row.storageCell].filter(Boolean).join(" / ") || "—"}
                            </span>
                            {row.unitCost != null && Number.isFinite(Number(row.unitCost)) ? (
                              <span className="muted whHideMd">
                                {" "}
                                · {fmtQty(Number(row.unitCost), 2)} ₽/ед.
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      <td className="whColNum whHideSm">
                        <span className={row.isLow ? "whQty bad" : "whQty"}>
                          {fmtQty(Number(row.available))} {row.materialUnit}
                        </span>
                      </td>
                      <td className="whColNum whHideSm muted">
                        {fmtQty(Number(row.quantity))}
                      </td>
                      {showReserve ? (
                        <td className="whColNum whHideSm muted">
                          {fmtQty(Number(row.reserved))}
                        </td>
                      ) : null}
                      <td className="whColLoc muted">
                        {[row.storageRoom, row.storageCell].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="whColNum muted">
                        {row.stockAmount != null && Number.isFinite(Number(row.stockAmount))
                          ? `${fmtQty(Number(row.stockAmount), 2)} ₽`
                          : "—"}
                      </td>
                      <td className="whColAct" onClick={(e) => e.stopPropagation()}>
                        <div className="whActBtns">
                          {canOpenMaterialCard ? (
                            <button
                              type="button"
                              className="ghostBtn whBtnCard"
                              title={
                                canEditMaterialCard
                                  ? "Редактировать карточку материала"
                                  : "Открыть карточку материала"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenMaterialCard(row.materialId, row.warehouseId);
                              }}
                            >
                              {canEditMaterialCard ? "Карточка" : "Открыть"}
                            </button>
                          ) : null}
                          <div className="whRowMenuWrap">
                            <button
                              type="button"
                              className="ghostBtn whBtnIcon"
                              aria-label="Ещё действия"
                              aria-expanded={rowMenu?.rowId === row.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setHeaderMenuRect(null);
                                setRowMenu((prev) =>
                                  prev?.rowId === row.id ? null : { rowId: row.id, rect }
                                );
                              }}
                            >
                              ⋯
                            </button>
                            {rowMenu?.rowId === row.id ? (
                              <WhFloatingMenu
                                anchorRect={rowMenu.rect}
                                onClose={() => setRowMenu(null)}
                              >
                                <WhMenuAction
                                  label={expanded ? "Свернуть строку" : "Подробнее по остатку"}
                                  onActivate={() => {
                                    onToggleExpand(row.id);
                                    setRowMenu(null);
                                  }}
                                />
                                {canOpenMaterialCard ? (
                                  <WhMenuAction
                                    label={
                                      canEditMaterialCard
                                        ? "Редактировать карточку"
                                        : "Карточка материала"
                                    }
                                    onActivate={() => {
                                      setRowMenu(null);
                                      onOpenMaterialCard(row.materialId, row.warehouseId);
                                    }}
                                  />
                                ) : null}
                                {isAdmin ? (
                                  <WhMenuAction
                                    label="Удалить из каталога"
                                    danger
                                    onActivate={() => {
                                      setRowMenu(null);
                                      onDeleteMaterial(row.materialId, row.materialName);
                                    }}
                                  />
                                ) : null}
                              </WhFloatingMenu>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr key={`${row.id}-detail`} className="whDetailRow">
                        <td colSpan={colSpan}>
                          <div className="whDetail">
                            <div className="whDetailActions">
                              {canOpenMaterialCard ? (
                                <button
                                  type="button"
                                  className="secondaryBtn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenMaterialCard(row.materialId, row.warehouseId);
                                  }}
                                >
                                  {canEditMaterialCard
                                    ? "Редактировать карточку"
                                    : "Открыть карточку материала"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="ghostBtn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleExpand(row.id);
                                }}
                              >
                                Свернуть
                              </button>
                            </div>
                            <div className="whDetailMetaGrid">
                              <span>
                                <strong>Доступно:</strong> {fmtQty(Number(row.available))} {row.materialUnit}
                              </span>
                              <span>
                                <strong>Остаток:</strong> {fmtQty(Number(row.quantity))}
                              </span>
                              <span>
                                <strong>Резерв:</strong> {fmtQty(Number(row.reserved))}
                              </span>
                              <span>
                                <strong>Место:</strong>{" "}
                                {[row.storageRoom, row.storageCell].filter(Boolean).join(" / ") || "—"}
                              </span>
                              {row.lineTotal != null &&
                              Number.isFinite(Number(row.lineTotal)) &&
                              row.priceBasisQty != null &&
                              Number(row.priceBasisQty) > 0 ? (
                                <span style={{ gridColumn: "1 / -1" }}>
                                  <strong>Сумма в карточке:</strong> {fmtQty(Number(row.lineTotal), 2)} ₽ за{" "}
                                  {fmtQty(Number(row.priceBasisQty))} {row.materialUnit}
                                  {row.unitCost != null && Number.isFinite(Number(row.unitCost))
                                    ? ` · ${fmtQty(Number(row.unitCost), 2)} ₽/ед.`
                                    : ""}
                                </span>
                              ) : null}
                              {row.stockAmount != null && Number.isFinite(Number(row.stockAmount)) ? (
                                <span style={{ gridColumn: "1 / -1" }}>
                                  <strong>Сумма остатка:</strong> {fmtQty(Number(row.stockAmount), 2)} ₽
                                </span>
                              ) : null}
                            </div>
                            {updFactsCount > 0 ? (
                              <section className="whDetailBlock">
                                <h4>Названия по УПД</h4>
                                <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                                  Номенклатура карточки: {row.materialName}
                                </p>
                                <ul className="whDetailList">
                                  {[...(updFactsByMaterialId.get(row.materialId)?.values() || [])].map(
                                    (x, i) => (
                                      <li key={`upd-${row.id}-${i}`}>
                                        <strong>{x.sourceName}</strong> ({x.sourceUnit || row.materialUnit}) —{" "}
                                        принято {fmtQty(x.quantity)}
                                      </li>
                                    )
                                  )}
                                </ul>
                              </section>
                            ) : (
                              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                                Фактических названий по УПД нет — при приёмке укажите наименование из документа,
                                отличное от номенклатуры в заявке.
                              </p>
                            )}
                            <section className="whDetailBlock">
                              <h4>Движения</h4>
                              {movementsLoading ? <p className="muted">Загрузка…</p> : null}
                              {movementsError ? <p className="error">{movementsError}</p> : null}
                              {!movementsLoading && !movements.length ? (
                                <p className="muted">Движений пока нет.</p>
                              ) : (
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
                                    {movements.map((m) => (
                                      <tr key={m.id}>
                                        <td>{new Date(m.createdAt).toLocaleString("ru-RU")}</td>
                                        <td>{m.direction === "IN" ? "Приход" : "Выдача"}</td>
                                        <td>
                                          {Number.isFinite(Number(m.quantity))
                                            ? fmtQty(Number(m.quantity))
                                            : m.quantity}
                                        </td>
                                        <td>
                                          {m.operation?.documentNumber ||
                                            m.issueRequest?.number ||
                                            m.sourceDocumentType}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </section>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
