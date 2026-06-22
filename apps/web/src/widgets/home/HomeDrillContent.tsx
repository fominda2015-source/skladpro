import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../../app/constants";
import { matchesSearchFields } from "../../shared/searchText";
import { LoadingState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { LimitTreeExplorer } from "../limits/LimitTreeExplorer";
import { receiptStatusLabel, receiptStatusTone } from "../receipts/receiptLabels";
import { formatMaterialQty } from "../../shared/quantity";
import { MobileCard, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

type Section = "SS" | "EOM";

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
  materialToolCatalogSection?: string | null;
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
  drillSection?: Section;
  safeName: (v: string) => string;
};

function resolveDrillSection(drillKey: string, drillSection: Section | undefined, defaultSection: Section): Section {
  if (drillSection) return drillSection;
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
  return (
    <LimitTreeExplorer
      warehouseId={warehouseId}
      section={section}
      token={token}
      fetchWithSession={fetchWithSession}
      safeName={safeName}
    />
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
  }, [token, fetchWithSession, warehouseId, section]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    return rows
      .filter((r) => !r.materialToolCatalogSection)
      .filter((r) => matchesSearchFields(search, r.materialName, r.materialSku))
      .sort((a, b) => b.available - a.available || a.materialName.localeCompare(b.materialName, "ru"));
  }, [rows, search]);

  if (loading) return <LoadingState text="Загрузка остатков…" />;
  if (error) return <p className="muted">{error}</p>;

  return (
    <div className="homeDrillStack">
      <div className="toolbar" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск ТМЦ (название, SKU)…"
          aria-label="Поиск остатков"
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
  const [rows, setRows] = useState<ReceiptRequestRow[]>([]);
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
  }, [token, fetchWithSession, warehouseId, section]);

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
  drillSection,
  safeName
}: Props) {
  const isStock = drillKind === "stat" && drillKey === "stock";
  const isLimits =
    (drillKind === "stat" && (drillKey === "limitsSs" || drillKey === "limitsEom")) ||
    (drillKind === "chart" && drillKey === "limits");
  const isReceipts = drillKind === "stat" && drillKey === "receipts";
  const section = resolveDrillSection(drillKey, drillSection, defaultSection);

  if (isStock) {
    return (
      <HomeDrillStockPanel
        warehouseId={warehouseId}
        section={section}
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
        section={section}
        token={token}
        fetchWithSession={fetchWithSession}
        safeName={safeName}
      />
    );
  }

  return <p className="muted">Откройте «Подробнее» для полной вкладки.</p>;
}
