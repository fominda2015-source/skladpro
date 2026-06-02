import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { API_URL } from "../../app/constants";
import { LoadingState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { LimitStructureBars } from "../limits/LimitStructureBars";
import { WarehouseStockView, type WarehouseStockRow } from "../warehouse/WarehouseStockView";
import { receiptStatusLabel, receiptStatusTone } from "../receipts/receiptLabels";

type Section = "SS" | "EOM";

type LimitImportNode = {
  id: string;
  parentId?: string | null;
  nodeType: "GROUP" | "MATERIAL";
  title: string;
  materialId?: string | null;
  materialName?: string | null;
  unit?: string | null;
  plannedQty?: string | number | null;
  issuedQty?: string | number | null;
  orderNo: number;
};

type LimitImportTemplate = {
  id: string;
  warehouseId: string;
  section: Section;
  title: string;
  nodes: LimitImportNode[];
};

type ReceiptRequestRow = {
  id: string;
  number: string;
  warehouseId: string;
  section: Section;
  status: "NEW" | "IN_PROGRESS" | "RECEIVED" | "CANCELLED";
  sourceFileName?: string | null;
  items: Array<{
    id: string;
    sourceName: string;
    quantity: string | number;
    acceptedQty?: string | number | null;
  }>;
  createdAt: string;
  fromLimit?: boolean;
  objectLimitTemplateId?: string | null;
};

type StockApiRow = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  section: Section;
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

type Props = {
  warehouseId: string;
  objectName: string;
  drillKind: "stat" | "chart";
  drillKey: string;
  token: string | null;
  fetchWithSession: typeof fetch;
  defaultSection: Section;
  safeName: (v: string) => string;
};

function drillSection(drillKey: string, defaultSection: Section): Section {
  if (drillKey === "limitsEom") return "EOM";
  if (drillKey === "limitsSs" || drillKey === "limits") return "SS";
  return defaultSection;
}

function HomeDrillLimitsPanel({
  warehouseId,
  section,
  token,
  fetchWithSession,
  safeName
}: {
  warehouseId: string;
  section: Section;
  token: string | null;
  fetchWithSession: typeof fetch;
  safeName: (v: string) => string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<LimitImportTemplate[]>([]);
  const [issuedByMaterial, setIssuedByMaterial] = useState<Record<string, number>>({});
  const [supplyByMaterial, setSupplyByMaterial] = useState<
    Record<string, { arrivedQty: number; issuedQty: number; onOrderQty: number; stockQty: number }>
  >({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ warehouseId, section });
    try {
      const [templatesRes, issuedRes, supplyRes] = await Promise.all([
        fetchWithSession(`${API_URL}/api/limit-imports?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchWithSession(`${API_URL}/api/stock-movements/issued-summary?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchWithSession(`${API_URL}/api/stock-movements/supply-metrics?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      if (!templatesRes.ok) throw new Error(`HTTP ${templatesRes.status}`);
      if (!issuedRes.ok) throw new Error(`HTTP ${issuedRes.status}`);
      const tpl = (await templatesRes.json()) as LimitImportTemplate[];
      const issuedRows = (await issuedRes.json()) as Array<{ materialId: string; issuedQty: number }>;
      setTemplates(tpl);
      setIssuedByMaterial(Object.fromEntries(issuedRows.map((x) => [x.materialId, Number(x.issuedQty) || 0])));
      if (supplyRes.ok) {
        const supplyRows = (await supplyRes.json()) as Array<{
          materialId: string;
          arrivedQty: number;
          issuedQty: number;
          onOrderQty: number;
          stockQty: number;
        }>;
        const next: typeof supplyByMaterial = {};
        for (const r of supplyRows) {
          next[r.materialId] = {
            arrivedQty: Number(r.arrivedQty) || 0,
            issuedQty: Number(r.issuedQty) || 0,
            onOrderQty: Number(r.onOrderQty) || 0,
            stockQty: Number(r.stockQty) || 0
          };
        }
        setSupplyByMaterial(next);
      } else {
        setSupplyByMaterial({});
      }
    } catch (e) {
      setError(`Не удалось загрузить лимиты: ${String(e)}`);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [token, fetchWithSession, warehouseId, section]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState text="Загрузка лимитов…" />;
  if (error) return <p className="muted">{error}</p>;
  if (!templates.length) return <p className="muted">Лимиты отсутствуют.</p>;

  return (
    <div className="homeDrillStack homeDrillTabEmbed limitsWorkspace">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <span className="muted">
          Раздел {section === "SS" ? "СС" : "ЭОМ"} · {templates.length} шаблон(ов)
        </span>
        <button type="button" className="ghostBtn" onClick={() => void load()}>
          ↻ Обновить
        </button>
      </div>
      {templates.map((tpl) => {
        const childrenByParent = new Map<string, LimitImportNode[]>();
        for (const n of tpl.nodes) {
          const key = n.parentId || "__root__";
          childrenByParent.set(key, [...(childrenByParent.get(key) || []), n]);
        }
        for (const arr of childrenByParent.values()) {
          arr.sort((a, b) => a.orderNo - b.orderNo);
        }
        const roots = (childrenByParent.get("__root__") || []).sort((a, b) => a.orderNo - b.orderNo);

        const renderNode = (node: LimitImportNode, depth: number): ReactNode => {
          const children = childrenByParent.get(node.id) || [];
          const isGroup = node.nodeType === "GROUP";
          const isExpanded = expanded[node.id] !== false;
          const planned = Number(node.plannedQty || 0);
          const issued = node.materialId ? Number(issuedByMaterial[node.materialId] || 0) : 0;
          const arrived = node.materialId ? Number(supplyByMaterial[node.materialId]?.arrivedQty || 0) : 0;

          if (isGroup) {
            return (
              <div key={node.id} style={{ marginLeft: depth * 10, marginTop: depth ? 2 : 4 }}>
                <div className="limitGroupRow" style={{ gap: 6, padding: "4px 0" }}>
                  <button
                    type="button"
                    className="ghostBtn"
                    style={{ width: 32, minWidth: 32, height: 32, borderRadius: 10 }}
                    disabled={!children.length}
                    onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isExpanded }))}
                  >
                    {children.length ? (isExpanded ? "▾" : "▸") : "•"}
                  </button>
                  <strong>{safeName(node.title)}</strong>
                </div>
                {isExpanded ? children.map((ch) => renderNode(ch, depth + 1)) : null}
              </div>
            );
          }

          return (
            <div key={node.id} className="limitMaterialRow" style={{ marginLeft: depth * 10, marginTop: 6 }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                {safeName(String(node.materialName || node.title || "Материал"))}
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                план {planned.toLocaleString("ru-RU")} · выдано {issued.toLocaleString("ru-RU")} · приход{" "}
                {arrived.toLocaleString("ru-RU")} {node.unit || "шт"}
              </div>
              {planned > 0 ? (
                <LimitStructureBars plan={planned} issued={issued} arrived={arrived} compact />
              ) : (
                <span className="muted">отсутствует</span>
              )}
            </div>
          );
        };

        return (
          <section key={tpl.id} className="card limitTemplateCard homeDrillObjectBlock">
            <header className="homeDrillObjectBlockHead">
              <strong>{safeName(tpl.title)}</strong>
              <span className="muted">{section}</span>
            </header>
            {roots.map((root) => renderNode(root, 0))}
          </section>
        );
      })}
    </div>
  );
}

function HomeDrillWarehousePanel({
  warehouseId,
  section,
  objectName,
  token,
  fetchWithSession,
  safeName
}: {
  warehouseId: string;
  section: Section;
  objectName: string;
  token: string | null;
  fetchWithSession: typeof fetch;
  safeName: (v: string) => string;
}) {
  const [sectionTab, setSectionTab] = useState<Section>(section);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<WarehouseStockRow[]>([]);
  const [search, setSearch] = useState("");
  const [kindTab, setKindTab] = useState<"ALL" | "MATERIAL" | "CONSUMABLE" | "WORKWEAR">("ALL");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ warehouseId, section: sectionTab });
    if (search.trim()) params.set("q", search.trim());
    try {
      const res = await fetchWithSession(`${API_URL}/api/stocks?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StockApiRow[];
      setRows(
        data.map((r) => ({
          id: r.id,
          warehouseId: r.warehouseId,
          warehouseName: safeName(r.warehouseName),
          materialId: r.materialId,
          materialName: safeName(r.materialName),
          materialSku: r.materialSku,
          materialUnit: r.materialUnit,
          materialKind: r.materialKind,
          unitPrice: r.unitPrice,
          quantity: r.quantity,
          reserved: r.reserved,
          storageRoom: r.storageRoom,
          storageCell: r.storageCell,
          available: r.available,
          isLow: r.isLow
        }))
      );
    } catch (e) {
      setError(`Не удалось загрузить склад: ${String(e)}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, fetchWithSession, warehouseId, sectionTab, search, safeName]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = rows;
    if (kindTab !== "ALL") list = list.filter((r) => r.materialKind === kindTab);
    return list;
  }, [rows, kindTab]);

  return (
    <div className="homeDrillTabEmbed stockPanel">
      <div className="tabs" style={{ marginBottom: 8 }}>
        <button type="button" className={sectionTab === "SS" ? "active" : ""} onClick={() => setSectionTab("SS")}>
          СС
        </button>
        <button type="button" className={sectionTab === "EOM" ? "active" : ""} onClick={() => setSectionTab("EOM")}>
          ЭОМ
        </button>
      </div>
      <WarehouseStockView
        sectionLabel={`${safeName(objectName)} · раздел ${sectionTab === "SS" ? "СС" : "ЭОМ"}`}
        rows={filtered}
        totalVisible={filtered.length}
        lowCount={filtered.filter((r) => r.isLow).length}
        loading={loading}
        error={error}
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={() => void load()}
        kindTab={kindTab}
        onKindTabChange={setKindTab}
        warehouseFilterId={warehouseId}
        onWarehouseFilterChange={() => undefined}
        warehouseOptions={[{ id: warehouseId, name: objectName }]}
        limitMaterialsOnly={false}
        onLimitMaterialsOnlyToggle={() => undefined}
        onlyAvailable={false}
        onOnlyAvailableChange={() => undefined}
        onlyLow={false}
        onOnlyLowChange={() => undefined}
        onlyFactNames={false}
        onOnlyFactNamesChange={() => undefined}
        showSku={true}
        onShowSkuChange={() => undefined}
        showReserve={true}
        onShowReserveChange={() => undefined}
        showPrice={false}
        onShowPriceChange={() => undefined}
        canWriteOperations={false}
        canOpenMaterialCard={false}
        isAdmin={false}
        onAddMaterial={() => undefined}
        onOpenJournal={() => undefined}
        exportSlot={null}
        expandedRowId=""
        onToggleExpand={() => undefined}
        onOpenMaterialCard={() => undefined}
        onDeleteMaterial={() => undefined}
        movementsByKey={new Map()}
        mappingsByMaterialId={new Map()}
        acceptedByMaterialId={new Map()}
        movementsLoading={false}
        movementsError=""
      />
    </div>
  );
}

function HomeDrillReceiptsPanel({
  warehouseId,
  token,
  fetchWithSession,
  safeName
}: {
  warehouseId: string;
  token: string | null;
  fetchWithSession: typeof fetch;
  safeName: (v: string) => string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ReceiptRequestRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ warehouseId });
    try {
      const res = await fetchWithSession(`${API_URL}/api/receipt-requests?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((await res.json()) as ReceiptRequestRow[]);
    } catch (e) {
      setError(`Не удалось загрузить приёмки: ${String(e)}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, fetchWithSession, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState text="Загрузка приёмок…" />;
  if (error) return <p className="muted">{error}</p>;
  if (!rows.length) return <p className="muted">Приёмок по объекту нет.</p>;

  return (
    <div className="homeDrillTabEmbed receiptsWorkspace">
      <div className="toolbar" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <button type="button" className="ghostBtn" onClick={() => void load()}>
          ↻ Обновить
        </button>
      </div>
      <div className="erpTableWrap">
        <table className="erpTable desktopTable">
          <thead>
            <tr>
              <th style={{ width: 40 }} />
              <th>Заявка</th>
              <th>Статус</th>
              <th>Прогресс</th>
              <th style={{ width: 72 }}>Поз.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isExpanded = expanded[row.id] !== false;
              const totalQty = row.items.reduce((s, it) => s + Number(it.quantity), 0);
              const acceptedQty = row.items.reduce((s, it) => s + Number(it.acceptedQty || 0), 0);
              const donePct = totalQty > 0 ? Math.min(100, Math.round((acceptedQty / totalQty) * 100)) : 0;
              return (
                <Fragment key={row.id}>
                  <tr className={isExpanded ? "rowHighlight" : undefined}>
                    <td>
                      <button
                        type="button"
                        className="erpRowToggle"
                        onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !isExpanded }))}
                      >
                        {isExpanded ? "▼" : "▶"}
                      </button>
                    </td>
                    <td>
                      <strong>{row.number}</strong>
                      {row.sourceFileName ? (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {row.sourceFileName}
                        </div>
                      ) : null}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {row.section}
                      </div>
                    </td>
                    <td>
                      <StatusBadge tone={receiptStatusTone(row.status)}>{receiptStatusLabel(row.status)}</StatusBadge>
                    </td>
                    <td>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {acceptedQty.toLocaleString("ru-RU")} / {totalQty.toLocaleString("ru-RU")} ({donePct}%)
                      </div>
                      <div className="progressWrap" style={{ width: "100%", marginTop: 4, maxWidth: 160 }}>
                        <div className="progressBar" style={{ width: `${donePct}%` }} />
                      </div>
                    </td>
                    <td>{row.items.length}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="erpTableExpand">
                      <td colSpan={5}>
                        <div className="erpTableExpandInner">
                          <table className="erpTable desktopTable" style={{ marginTop: 4 }}>
                            <thead>
                              <tr>
                                <th>Позиция</th>
                                <th>Заказано</th>
                                <th>Принято</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.items.map((it) => (
                                <tr key={it.id}>
                                  <td>{safeName(it.sourceName || "—")}</td>
                                  <td>{Number(it.quantity).toLocaleString("ru-RU")}</td>
                                  <td>{Number(it.acceptedQty || 0).toLocaleString("ru-RU")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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
    </div>
  );
}

export function HomeDrillContent({
  warehouseId,
  objectName,
  drillKind,
  drillKey,
  token,
  fetchWithSession,
  defaultSection,
  safeName
}: Props) {
  const isStock = drillKind === "stat" && drillKey === "stock";
  const isLimits =
    (drillKind === "stat" && (drillKey === "limitsSs" || drillKey === "limitsEom")) ||
    (drillKind === "chart" && drillKey === "limits");
  const isReceipts = drillKind === "stat" && drillKey === "receipts";
  const section = drillSection(drillKey, defaultSection);

  if (isStock) {
    return (
      <HomeDrillWarehousePanel
        warehouseId={warehouseId}
        section={defaultSection}
        objectName={objectName}
        token={token}
        fetchWithSession={fetchWithSession}
        safeName={safeName}
      />
    );
  }
  if (isLimits) {
    return (
      <HomeDrillLimitsPanel
        warehouseId={warehouseId}
        section={section}
        token={token}
        fetchWithSession={fetchWithSession}
        safeName={safeName}
      />
    );
  }
  if (isReceipts) {
    return (
      <HomeDrillReceiptsPanel
        warehouseId={warehouseId}
        token={token}
        fetchWithSession={fetchWithSession}
        safeName={safeName}
      />
    );
  }

  return <p className="muted">Откройте «Подробнее» для полной вкладки.</p>;
}
