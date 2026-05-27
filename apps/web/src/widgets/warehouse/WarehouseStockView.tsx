import { Fragment, useState, type ReactNode } from "react";
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
  unitPrice?: number | null;
  quantity: number;
  reserved: number;
  storageRoom?: string | null;
  storageCell?: string | null;
  available: number;
  isLow: boolean;
};

type MappingRow = { id: string; sourceName: string; sourceUnit?: string | null };
type AcceptedEntry = { sourceName: string; sourceUnit: string; quantity: number };
type MovementSlice = {
  id: string;
  createdAt: string;
  direction: "IN" | "OUT";
  quantity: string;
  sourceDocumentType: string;
  operation?: { documentNumber?: string | null } | null;
  issueRequest?: { number?: string } | null;
};

type KindTab = "ALL" | "MATERIAL" | "CONSUMABLE" | "WORKWEAR";

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
  mappingsByMaterialId: Map<string, MappingRow[]>;
  acceptedByMaterialId: Map<string, Map<string, AcceptedEntry>>;
  movementsLoading?: boolean;
  movementsError?: string;
};

function fmtQty(n: number, maxFrac = 3): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: maxFrac });
}

function kindLabel(kind?: WarehouseStockRow["materialKind"]): string {
  if (kind === "CONSUMABLE") return "Расходник";
  if (kind === "WORKWEAR") return "Спецодежда";
  return "Материал";
}

function kindTone(kind?: WarehouseStockRow["materialKind"]): string {
  if (kind === "CONSUMABLE") return "chip warn";
  if (kind === "WORKWEAR") return "chip ok";
  return "chip neutral";
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
    mappingsByMaterialId,
    acceptedByMaterialId,
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
            <button type="button" className="primaryBtn whBtnPrimary" onClick={onAddMaterial}>
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
        <button type="button" className="secondaryBtn" onClick={onSearchSubmit}>
          Найти
        </button>
      </div>

      <div className="whToolbar">
        <div className="whChips" role="tablist" aria-label="Вид номенклатуры">
          {(
            [
              ["ALL", "Все"],
              ["MATERIAL", "Материалы"],
              ["CONSUMABLE", "Расходники"],
              ["WORKWEAR", "Спецодежда"]
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kindTab === k}
              className={`chip ${kindTab === k ? "active" : ""}`}
              onClick={() => onKindTabChange(k)}
            >
              {label}
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
          className={limitMaterialsOnly ? "secondaryBtn" : "ghostBtn"}
          onClick={onLimitMaterialsOnlyToggle}
        >
          {limitMaterialsOnly ? "Только лимит" : "Все позиции"}
        </button>
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
            Цена
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
                <th className="whColLoc whHideMd">Место</th>
                {showPrice ? <th className="whColNum whHideMd">Цена</th> : null}
                <th className="whColAct" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = expandedRowId === row.id;
                const factsCount = mappingsByMaterialId.get(row.materialId)?.length || 0;
                const acceptedCount = acceptedByMaterialId.get(row.materialId)?.size || 0;
                const movements = movementsByKey.get(`${row.warehouseId}::${row.materialId}`) || [];
                const colSpan = 5 + (showReserve ? 1 : 0) + (showPrice ? 1 : 0);

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
                            <span className={kindTone(row.materialKind)}>{kindLabel(row.materialKind)}</span>
                            <span className="muted"> · {row.warehouseName}</span>
                            {showSku && row.materialSku ? (
                              <span className="muted"> · {row.materialSku}</span>
                            ) : null}
                            {(factsCount > 0 || acceptedCount > 0) ? (
                              <span className="muted"> · факт: {factsCount + acceptedCount}</span>
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
                      <td className="whColLoc whHideMd muted">
                        {[row.storageRoom, row.storageCell].filter(Boolean).join(" / ") || "—"}
                      </td>
                      {showPrice ? (
                        <td className="whColNum whHideMd muted">
                          {row.unitPrice != null && Number.isFinite(Number(row.unitPrice))
                            ? `${fmtQty(Number(row.unitPrice), 2)} ₽`
                            : "—"}
                        </td>
                      ) : null}
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
                              {row.unitPrice != null && Number.isFinite(Number(row.unitPrice)) ? (
                                <span style={{ gridColumn: "1 / -1" }}>
                                  <strong>Цена за ед.:</strong> {fmtQty(Number(row.unitPrice), 2)} ₽
                                </span>
                              ) : null}
                            </div>
                            {(factsCount > 0 || acceptedCount > 0) ? (
                              <section className="whDetailBlock">
                                <h4>Фактические названия</h4>
                                <ul className="whDetailList">
                                  {[...(acceptedByMaterialId.get(row.materialId)?.values() || [])].map(
                                    (x, i) => (
                                      <li key={`acc-${row.id}-${i}`}>
                                        <strong>{x.sourceName}</strong> ({x.sourceUnit || row.materialUnit}) —{" "}
                                        принято {fmtQty(x.quantity)}
                                      </li>
                                    )
                                  )}
                                  {(mappingsByMaterialId.get(row.materialId) || [])
                                    .filter((m) => {
                                      const bucket = acceptedByMaterialId.get(row.materialId);
                                      return !bucket?.has(`${m.sourceName}|${m.sourceUnit || ""}`);
                                    })
                                    .map((m) => (
                                      <li key={m.id}>
                                        {m.sourceName} ({m.sourceUnit || row.materialUnit}) —{" "}
                                        <span className="muted">не принято</span>
                                      </li>
                                    ))}
                                </ul>
                              </section>
                            ) : null}
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
