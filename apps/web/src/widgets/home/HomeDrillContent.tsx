import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { API_URL } from "../../app/constants";
import { LoadingState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { LimitStructureBars } from "../limits/LimitStructureBars";
import { limitNodeArrivedQty } from "../limits/limitReceiptMetrics";
import { receiptStatusLabel, receiptStatusTone } from "../receipts/receiptLabels";
import { formatMaterialQty } from "../../shared/quantity";
import { MobileCard, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

const metricFmt = (n: number) => formatMaterialQty(n);

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

  useEffect(() => {
    setExpanded({});
  }, [warehouseId, section]);

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
          Раздел {section === "SS" ? "СС" : "ЭОМ"} · {templates.length ? "активный лимит" : "нет"}
          {templates.length > 1 ? ` · ${templates.length - 1} в архиве` : ""}
        </span>
        <button type="button" className="ghostBtn" onClick={() => void load()}>
          ↻ Обновить
        </button>
      </div>
      {templates.slice(0, 1).map((tpl) => {
        const childrenByParent = new Map<string, LimitImportNode[]>();
        for (const n of tpl.nodes) {
          const key = n.parentId || "__root__";
          childrenByParent.set(key, [...(childrenByParent.get(key) || []), n]);
        }
        for (const arr of childrenByParent.values()) {
          arr.sort((a, b) => a.orderNo - b.orderNo);
        }
        const roots = (childrenByParent.get("__root__") || []).sort((a, b) => a.orderNo - b.orderNo);

        const materialArrived = (node: LimitImportNode) =>
          limitNodeArrivedQty(node.id, node.materialId, {}, node.materialId ? supplyByMaterial[node.materialId] : null);

        const materialIssued = (node: LimitImportNode) => {
          const fromNode = Number(node.issuedQty || 0);
          if (!node.materialId) return fromNode;
          return Math.max(fromNode, Number(issuedByMaterial[node.materialId] || 0));
        };

        const renderNode = (node: LimitImportNode, depth: number): ReactNode => {
          const children = childrenByParent.get(node.id) || [];
          const isGroup = node.nodeType === "GROUP";
          const isExpanded = expanded[node.id] === true;
          const planned = Number(node.plannedQty || 0);
          const issued = materialIssued(node);
          const arrived = materialArrived(node);
          const isOver = planned > 0 && issued > planned;
          const directMaterials = children.filter((c) => c.nodeType === "MATERIAL");
          const childGroups = children.filter((c) => c.nodeType === "GROUP");

          if (isGroup) {
            const agg = (() => {
              let plan = 0;
              let arr = 0;
              let iss = 0;
              const walk = (id: string) => {
                const n = tpl.nodes.find((x) => x.id === id);
                if (!n) return;
                if (n.nodeType === "MATERIAL") {
                  plan += Number(n.plannedQty || 0);
                  arr += materialArrived(n);
                  iss += materialIssued(n);
                  return;
                }
                for (const ch of childrenByParent.get(id) || []) walk(ch.id);
              };
              walk(node.id);
              return { plan, arrived: arr, issued: iss };
            })();
            const groupArrivedPct =
              agg.plan > 0 ? Math.min(100, Math.round((agg.arrived / agg.plan) * 100)) : 0;
            const groupIssuedPct =
              agg.plan > 0 ? Math.min(100, Math.round((agg.issued / agg.plan) * 100)) : 0;

            return (
              <div key={node.id} style={{ marginLeft: depth * 10, marginTop: depth ? 2 : 4 }}>
                <div className="limitGroupRow limitGroupRow--homeDrill">
                  <button
                    type="button"
                    className="ghostBtn"
                    style={{ width: 32, minWidth: 32, height: 32, borderRadius: 10 }}
                    disabled={!children.length}
                    onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isExpanded }))}
                  >
                    {children.length ? (isExpanded ? "▾" : "▸") : "•"}
                  </button>
                  <div className="limitGroupRowMain">
                    <strong style={{ color: "#243656" }}>{safeName(node.title)}</strong>
                    {agg.plan > 0 ? (
                      <span className="muted limitGroupMetrics" style={{ fontSize: 11 }}>
                        приход {metricFmt(agg.arrived)} / {metricFmt(agg.plan)} ({groupArrivedPct}%) · выдача{" "}
                        {metricFmt(agg.issued)} / {metricFmt(agg.plan)} ({groupIssuedPct}%)
                      </span>
                    ) : null}
                  </div>
                  {agg.plan > 0 ? (
                    <div className="limitGroupRowBars">
                      <LimitStructureBars plan={agg.plan} issued={agg.issued} arrived={agg.arrived} compact />
                    </div>
                  ) : null}
                </div>
                {isExpanded && directMaterials.length > 0 ? (
                  <div style={{ marginLeft: (depth + 1) * 10, marginBottom: 8, overflowX: "auto" }}>
                    <table className="limitMaterialsTable">
                      <thead>
                        <tr>
                          <th>Материал</th>
                          <th className="num">Ед.</th>
                          <th className="num">План</th>
                          <th className="num">Приход</th>
                          <th className="num">Выдано</th>
                          <th className="num">Привезти</th>
                          <th className="num">В закупке</th>
                          <th className="num">На складе</th>
                          <th className="structureCell">Структура</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directMaterials.map((m) => {
                          const plan = Number(m.plannedQty || 0);
                          const sm = m.materialId ? supplyByMaterial[m.materialId] : undefined;
                          const arr = materialArrived(m);
                          const iss = materialIssued(m);
                          const onOrd = sm?.onOrderQty ?? 0;
                          const stk = sm?.stockQty ?? 0;
                          const remain = Math.max(0, plan - arr);
                          return (
                            <tr key={`mt-${node.id}-${m.id}`}>
                              <td className="matName">{safeName(String(m.materialName || m.title || ""))}</td>
                              <td className="num">{m.unit || "шт"}</td>
                              <td className="num">{metricFmt(plan)}</td>
                              <td className="num">{m.materialId ? metricFmt(arr) : "—"}</td>
                              <td className="num">{m.materialId ? metricFmt(iss) : "—"}</td>
                              <td className="num">{m.materialId ? metricFmt(remain) : "—"}</td>
                              <td className="num">{m.materialId ? metricFmt(onOrd) : "—"}</td>
                              <td className="num">{m.materialId ? metricFmt(stk) : "—"}</td>
                              <td className="structureCell">
                                {m.materialId && plan > 0 ? (
                                  <LimitStructureBars plan={plan} issued={iss} arrived={arr} />
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {isExpanded ? childGroups.map((ch) => renderNode(ch, depth + 1)) : null}
              </div>
            );
          }

          const nodeTitle = String(node.materialName || node.title || "");
          const qtyText = `${Math.round(issued)} / ${Number.isFinite(planned) ? planned : 0} ${node.unit || "шт"}`;
          return (
            <div key={node.id} className={`limitMaterialRow ${isOver ? "low" : ""}`} style={{ marginLeft: depth * 10, marginTop: 6 }}>
              <div className="rightCardHeader" style={{ marginBottom: 8, gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 13 }}>{safeName(nodeTitle)}</strong>
                  <div className="muted">{node.unit || "шт"}</div>
                </div>
                <span className={`badge ${isOver ? "bad" : "ok"}`}>{qtyText}</span>
              </div>
              {planned > 0 ? (
                <div style={{ marginTop: 6, maxWidth: 320 }}>
                  <LimitStructureBars plan={planned} issued={issued} arrived={arrived} compact />
                </div>
              ) : null}
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

function HomeDrillStockPanel({
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
  const [rows, setRows] = useState<StockApiRow[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ warehouseId, section });
    if (search.trim()) params.set("q", search.trim());
    try {
      const res = await fetchWithSession(`${API_URL}/api/stocks?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((await res.json()) as StockApiRow[]);
    } catch (e) {
      setError(`Не удалось загрузить остатки: ${String(e)}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, fetchWithSession, warehouseId, section, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (!q) return true;
        return (
          r.materialName.toLowerCase().includes(q) ||
          String(r.materialSku || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.available - a.available || a.materialName.localeCompare(b.materialName, "ru"));
  }, [rows, search]);

  if (loading) return <LoadingState text="Загрузка остатков…" />;
  if (error) return <p className="muted">{error}</p>;

  return (
    <div className="homeDrillStack">
      <div className="toolbar" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load();
          }}
          placeholder="Поиск ТМЦ (название, SKU)…"
          style={{ minWidth: 260 }}
        />
        <button type="button" className="ghostBtn" onClick={() => void load()}>
          ↻ Обновить
        </button>
      </div>
      <ResponsiveTableShell>
      <div className="erpTableWrap homeDrillTable">
        <table className="erpTable desktopTable">
          <thead>
            <tr>
              <th>ТМЦ</th>
              <th>Раздел</th>
              <th>Ед.</th>
              <th>В наличии</th>
              <th>Резерв</th>
              <th>Количество</th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, 200).map((r) => (
              <tr key={`drill-stock-${r.id}`}>
                <td>{safeName(r.materialName)}</td>
                <td>{r.section}</td>
                <td>{r.materialUnit}</td>
                <td>{r.available.toLocaleString("ru-RU")}</td>
                <td>{r.reserved.toLocaleString("ru-RU")}</td>
                <td>{r.quantity.toLocaleString("ru-RU")}</td>
              </tr>
            ))}
            {!visible.length ? (
              <tr>
                <td colSpan={6} className="muted">
                  ТМЦ не найдено.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mobileCards">
        {visible.slice(0, 200).map((r) => (
          <MobileCard key={`m-drill-stock-${r.id}`}>
            <h4>{safeName(r.materialName)}</h4>
            <MobileCardField label="Раздел">{r.section}</MobileCardField>
            <MobileCardField label="В наличии">{r.available.toLocaleString("ru-RU")}</MobileCardField>
            <MobileCardField label="Резерв">{r.reserved.toLocaleString("ru-RU")}</MobileCardField>
            <MobileCardField label="Количество">{r.quantity.toLocaleString("ru-RU")}</MobileCardField>
          </MobileCard>
        ))}
      </div>
      </ResponsiveTableShell>
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

  useEffect(() => {
    setExpanded({});
  }, [warehouseId]);

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
              const isExpanded = expanded[row.id] === true;
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
                                  <td>{formatMaterialQty(it.acceptedQty)}</td>
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
  objectName: _objectName,
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
      <HomeDrillStockPanel
        warehouseId={warehouseId}
        section={defaultSection}
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
