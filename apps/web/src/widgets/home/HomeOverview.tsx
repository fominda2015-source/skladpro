import { Fragment, useMemo, type ReactNode } from "react";
import { StatusBadge, objectRiskLabel, objectRiskStatus } from "../../shared/ui/StatusBadge";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { PageHero } from "../ui/PageHero";

export type HomeToolCategory = {
  key: string;
  label: string;
  icon: string | null;
  count: number;
  inStock: number;
  issued: number;
  inRepair: number;
};

export type HomeLimitSlice = {
  hasTemplate: boolean;
  plannedQty: number;
  issuedQty: number;
  percent: number;
  overCount: number;
};

export type HomeMovementTrendRow = {
  day: string;
  income: number;
  outcome: number;
};

export type HomeOverviewSummary = {
  objectCount: number;
  campTotal: number;
  limitsSs: HomeLimitSlice;
  limitsEom: HomeLimitSlice;
  limitsOverLines: number;
  objectsWithoutTemplate: number;
  toolsTotal: number;
  toolsInStock: number;
  toolsIssued: number;
  toolsInRepair: number;
  toolsCalibrationOverdue?: number;
  toolsCalibrationDueSoon?: number;
  stockLines: number;
  receiptOpen: number;
  toolsByCategory: HomeToolCategory[];
  movementTrend30d?: HomeMovementTrendRow[];
};

export type HomeObjectRow = {
  warehouseId: string;
  name: string;
  campSs: number;
  campEom: number;
  stockLines: number;
  receiptOpen: number;
  limitsSs: HomeLimitSlice;
  limitsEom: HomeLimitSlice;
  tools: {
    total: number;
    inStock: number;
    issued: number;
    inRepair: number;
    categories: HomeToolCategory[];
  };
};

type Props = {
  objects: HomeObjectRow[];
  highlightWarehouseId?: string;
  summary?: HomeOverviewSummary | null;
  loading: boolean;
  error: string;
  generatedAt?: string;
  expandedId: string | null;
  onExpand: (warehouseId: string | null) => void;
  onRefresh: () => void;
  onOpenCamp: (warehouseId: string) => void;
  onOpenLimits: (warehouseId: string, section: "SS" | "EOM") => void;
  onOpenTools: (warehouseId: string) => void;
  onOpenWarehouse?: (warehouseId: string) => void;
  onOpenOperations?: (warehouseId: string) => void;
  canCamp?: boolean;
  canLimits?: boolean;
  canTools?: boolean;
  canWarehouse?: boolean;
  canOperations?: boolean;
  announcements?: ReactNode;
  onOpenQr?: () => void;
  onOpenIssues?: () => void;
  onOpenApprovals?: () => void;
  onOpenVerifications?: () => void;
  onCreateRequest?: () => void;
  onAcceptReturn?: () => void;
};

const TOOL_PIE_COLORS = ["#4f46e5", "#0ea5e9", "#f59e0b"] as const;
const LIMIT_SS_COLOR = "#4f46e5";
const LIMIT_EOM_COLOR = "#0ea5e9";

function fmtQty(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

function shortName(name: string, max = 14) {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function chartTooltipQty(value: unknown): [string, string] {
  const n = typeof value === "number" ? value : Number(value);
  return [Number.isFinite(n) ? n.toLocaleString("ru-RU") : "—", ""];
}

export function HomeOverview({
  objects,
  highlightWarehouseId = "",
  summary,
  loading,
  error,
  generatedAt,
  expandedId,
  onExpand,
  onRefresh,
  onOpenCamp,
  onOpenLimits,
  onOpenTools,
  onOpenWarehouse,
  onOpenOperations,
  canCamp = true,
  canLimits = true,
  canTools = true,
  canWarehouse = true,
  canOperations = true,
  announcements = null,
  onOpenQr,
  onOpenIssues,
  onOpenApprovals,
  onOpenVerifications,
  onCreateRequest,
  onAcceptReturn
}: Props) {
  const totals = useMemo(() => {
    if (summary) {
      return {
        camp: summary.campTotal,
        tools: summary.toolsTotal,
        ss: summary.limitsSs,
        eom: summary.limitsEom,
        overLines: summary.limitsOverLines,
        stockLines: summary.stockLines,
        receiptOpen: summary.receiptOpen,
        toolsInRepair: summary.toolsInRepair,
        withoutTemplate: summary.objectsWithoutTemplate,
        toolsInStock: summary.toolsInStock,
        toolsIssued: summary.toolsIssued
      };
    }
    let camp = 0;
    let tools = 0;
    let overLines = 0;
    let stockLines = 0;
    let receiptOpen = 0;
    let toolsInRepair = 0;
    let withoutTemplate = 0;
    let toolsInStock = 0;
    let toolsIssued = 0;
    const ss = { plannedQty: 0, issuedQty: 0, overCount: 0, hasTemplate: false, percent: 0 };
    const eom = { ...ss };
    for (const o of objects) {
      camp += o.campSs + o.campEom;
      tools += o.tools.total;
      overLines += o.limitsSs.overCount + o.limitsEom.overCount;
      stockLines += o.stockLines;
      receiptOpen += o.receiptOpen;
      toolsInRepair += o.tools.inRepair;
      toolsInStock += o.tools.inStock;
      toolsIssued += o.tools.issued;
      if (!o.limitsSs.hasTemplate && !o.limitsEom.hasTemplate) withoutTemplate += 1;
      if (o.limitsSs.hasTemplate) {
        ss.hasTemplate = true;
        ss.plannedQty += o.limitsSs.plannedQty;
        ss.issuedQty += o.limitsSs.issuedQty;
        ss.overCount += o.limitsSs.overCount;
      }
      if (o.limitsEom.hasTemplate) {
        eom.hasTemplate = true;
        eom.plannedQty += o.limitsEom.plannedQty;
        eom.issuedQty += o.limitsEom.issuedQty;
        eom.overCount += o.limitsEom.overCount;
      }
    }
    ss.percent = ss.plannedQty > 0 ? Math.min(100, Math.round((ss.issuedQty / ss.plannedQty) * 100)) : 0;
    eom.percent = eom.plannedQty > 0 ? Math.min(100, Math.round((eom.issuedQty / eom.plannedQty) * 100)) : 0;
    return {
      camp,
      tools,
      ss,
      eom,
      overLines,
      stockLines,
      receiptOpen,
      toolsInRepair,
      withoutTemplate,
      toolsInStock,
      toolsIssued
    };
  }, [objects, summary]);

  const limitsChartRows = useMemo(
    () =>
      objects
        .filter(
          (o) =>
            (o.limitsSs.hasTemplate && o.limitsSs.plannedQty > 0) ||
            (o.limitsEom.hasTemplate && o.limitsEom.plannedQty > 0)
        )
        .map((o) => ({
          id: o.warehouseId,
          name: shortName(o.name, 16),
          fullName: o.name,
          ss: o.limitsSs.hasTemplate && o.limitsSs.plannedQty > 0 ? o.limitsSs.percent : null,
          eom: o.limitsEom.hasTemplate && o.limitsEom.plannedQty > 0 ? o.limitsEom.percent : null,
          ssOver: o.limitsSs.overCount,
          eomOver: o.limitsEom.overCount
        }))
        .sort((a, b) => Math.max(b.ss ?? 0, b.eom ?? 0) - Math.max(a.ss ?? 0, a.eom ?? 0)),
    [objects]
  );

  const campChartRows = useMemo(
    () =>
      objects
        .map((o) => ({
          id: o.warehouseId,
          name: shortName(o.name, 12),
          fullName: o.name,
          camp: o.campSs + o.campEom,
          tools: o.tools.total
        }))
        .filter((r) => r.camp > 0 || r.tools > 0)
        .sort((a, b) => b.camp - a.camp || b.tools - a.tools),
    [objects]
  );

  const toolsPieData = useMemo(() => {
    const inStock = summary?.toolsInStock ?? totals.toolsInStock;
    const issued = summary?.toolsIssued ?? totals.toolsIssued;
    const inRepair = summary?.toolsInRepair ?? totals.toolsInRepair;
    return [
      { name: "На складе", value: inStock, key: "stock" },
      { name: "Выдано", value: issued, key: "issued" },
      { name: "В ремонте", value: inRepair, key: "repair" }
    ].filter((s) => s.value > 0);
  }, [summary, totals]);

  const movementChartRows = useMemo(() => {
    const src = summary?.movementTrend30d;
    if (!src?.length) return [];
    return src.map((r) => ({
      ...r,
      label: r.day.slice(5).replace("-", ".")
    }));
  }, [summary?.movementTrend30d]);

  const topToolsRows = useMemo(() => {
    const src = summary?.toolsByCategory?.length
      ? summary.toolsByCategory
      : objects.flatMap((o) => o.tools.categories);
    return [...src]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((c) => ({
        name: shortName(c.icon ? `${c.icon} ${c.label}` : c.label, 16),
        fullName: c.label,
        count: c.count
      }));
  }, [objects, summary]);

  const attentionItems = useMemo(() => {
    const items: Array<{ id: string; label: string; value: number; tone: "bad" | "warn"; onClick?: () => void }> =
      [];
    if (totals.overLines > 0) {
      items.push({
        id: "over",
        label: "Перерасход лимитов",
        value: totals.overLines,
        tone: "bad",
        onClick: canLimits && objects[0] ? () => onOpenLimits(objects[0].warehouseId, "SS") : undefined
      });
    }
    if (totals.withoutTemplate > 0) {
      items.push({
        id: "noTpl",
        label: "Без шаблона лимитов",
        value: totals.withoutTemplate,
        tone: "warn"
      });
    }
    if (totals.toolsInRepair > 0) {
      items.push({
        id: "repair",
        label: "Инструмент в ремонте",
        value: totals.toolsInRepair,
        tone: "warn",
        onClick: canTools && objects[0] ? () => onOpenTools(objects[0].warehouseId) : undefined
      });
    }
    if (totals.receiptOpen > 0) {
      items.push({
        id: "rcp",
        label: "Приёмки в работе",
        value: totals.receiptOpen,
        tone: "warn",
        onClick:
          canOperations && objects[0] && onOpenOperations
            ? () => onOpenOperations(objects[0].warehouseId)
            : undefined
      });
    }
    const calOver = summary?.toolsCalibrationOverdue ?? 0;
    if (calOver > 0) {
      items.push({
        id: "cal",
        label: "Просрочены поверки",
        value: calOver,
        tone: "bad",
        onClick: onOpenVerifications
      });
    }
    return items;
  }, [totals, objects, summary, canLimits, canTools, canOperations, onOpenLimits, onOpenTools, onOpenOperations, onOpenVerifications]);

  const showCharts = objects.length > 0 && !loading;

  const sortedObjects = useMemo(() => {
    const score = (o: HomeObjectRow) => {
      const over = o.limitsSs.overCount + o.limitsEom.overCount;
      if (over > 0) return 100;
      if (o.receiptOpen > 0) return 50;
      const pct = Math.max(
        o.limitsSs.hasTemplate ? o.limitsSs.percent : 0,
        o.limitsEom.hasTemplate ? o.limitsEom.percent : 0
      );
      return pct;
    };
    return [...objects].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, "ru"));
  }, [objects]);

  const focusWarehouseId = highlightWarehouseId || sortedObjects[0]?.warehouseId || "";

  return (
    <div className="homeOverview tabShell">
      <PageHero
        variant="compact"
        icon="⌂"
        title="Главная"
        subtitle={
          <>
            Сводка по всем объектам · лимиты СС и ЭОМ
            {generatedAt ? (
              <span className="homeOverviewMeta"> · обновлено {new Date(generatedAt).toLocaleTimeString()}</span>
            ) : null}
          </>
        }
        actions={
          <button type="button" className="ghostBtn" onClick={onRefresh} disabled={loading}>
            ↻ Обновить
          </button>
        }
        stats={[
          { label: "Позиций на складе", value: fmtQty(totals.stockLines), tone: "neutral" },
          { label: "Инструменты", value: totals.tools, tone: "neutral" },
          {
            label: "На складе",
            value: summary?.toolsInStock ?? totals.toolsInStock,
            tone: "ok"
          },
          {
            label: "Выдано",
            value: summary?.toolsIssued ?? totals.toolsIssued,
            tone: "neutral"
          },
          {
            label: "В ремонте",
            value: summary?.toolsInRepair ?? totals.toolsInRepair,
            tone: totals.toolsInRepair > 0 ? "warn" : "neutral"
          },
          {
            label: "Приёмки",
            value: totals.receiptOpen,
            tone: totals.receiptOpen > 0 ? "warn" : "neutral"
          }
        ]}
      />

      <div className="erpQuickActions">
        {canWarehouse && focusWarehouseId ? (
          <button type="button" className="primaryBtn" onClick={() => onOpenWarehouse?.(focusWarehouseId)}>
            Открыть склад
          </button>
        ) : null}
        {canLimits && focusWarehouseId ? (
          <button type="button" className="ghostBtn" onClick={() => onOpenLimits(focusWarehouseId, "SS")}>
            Лимиты
          </button>
        ) : null}
        {onCreateRequest ? (
          <button type="button" className="ghostBtn" onClick={onCreateRequest}>
            Заявка
          </button>
        ) : null}
        {onOpenApprovals ? (
          <button type="button" className="ghostBtn" onClick={onOpenApprovals}>
            Заявки
          </button>
        ) : null}
        {onOpenIssues ? (
          <button type="button" className="ghostBtn" onClick={onOpenIssues}>
            Выдача
          </button>
        ) : null}
        {canTools && focusWarehouseId ? (
          <button type="button" className="ghostBtn" onClick={() => onOpenTools(focusWarehouseId)}>
            Инструменты
          </button>
        ) : null}
        {canOperations && focusWarehouseId ? (
          <button type="button" className="ghostBtn" onClick={() => onOpenOperations?.(focusWarehouseId)}>
            Приходы
          </button>
        ) : null}
        {onOpenQr ? (
          <button type="button" className="ghostBtn" onClick={onOpenQr}>
            QR-сканер
          </button>
        ) : null}
        {onOpenVerifications ? (
          <button type="button" className="ghostBtn" onClick={onOpenVerifications}>
            Поверки
          </button>
        ) : null}
        {onAcceptReturn ? (
          <button type="button" className="ghostBtn" onClick={onAcceptReturn}>
            Принять возврат
          </button>
        ) : null}
      </div>

      <div className="homeDashboard">
        <div className="homeDashboardMain">
      {showCharts ? (
        <div className="homeInsightRow">
          {canWarehouse && totals.stockLines > 0 ? (
            <button
              type="button"
              className="homeInsightPill"
              onClick={() => onOpenWarehouse?.(objects[0]?.warehouseId || "")}
              disabled={!onOpenWarehouse}
            >
              <span className="homeInsightPillLabel">Позиций на складе</span>
              <strong>{fmtQty(totals.stockLines)}</strong>
            </button>
          ) : null}
          {totals.receiptOpen > 0 ? (
            <button
              type="button"
              className="homeInsightPill"
              disabled={!canOperations || !onOpenOperations}
              onClick={() => onOpenOperations?.(objects[0]?.warehouseId || "")}
            >
              <span className="homeInsightPillLabel">Приёмки в работе</span>
              <strong>{totals.receiptOpen}</strong>
            </button>
          ) : null}
          {totals.overLines > 0 ? (
            <span className="homeInsightPill tone-bad">
              <span className="homeInsightPillLabel">Перерасход</span>
              <strong>{totals.overLines}</strong>
            </span>
          ) : null}
          {totals.toolsInRepair > 0 ? (
            <span className="homeInsightPill tone-warn">
              <span className="homeInsightPillLabel">В ремонте</span>
              <strong>{totals.toolsInRepair}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {attentionItems.length > 0 ? (
        <section className="homeAttentionStrip">
          {attentionItems.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`homeAttentionChip ${it.tone}`}
              disabled={!it.onClick}
              onClick={it.onClick}
            >
              <span>{it.label}</span>
              <strong>{it.value}</strong>
            </button>
          ))}
        </section>
      ) : null}

      {showCharts ? (
        <div className="homeChartsGrid">
          {movementChartRows.length > 0 ? (
            <section className="homeChartCard" style={{ gridColumn: "1 / -1" }}>
              <header className="homeChartHead">
                <h3>Движение за 30 дней</h3>
                <span className="muted">приход и расход по складам</span>
              </header>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={movementChartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={chartTooltipQty} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="income" name="Приход" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outcome" name="Расход" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          ) : null}
          <section className="homeChartCard">
            <header className="homeChartHead">
              <h3>Выполнение лимитов</h3>
              <span className="muted">СС и ЭОМ, % выдано / план</span>
            </header>
            {limitsChartRows.length ? (
              <ResponsiveContainer width="100%" height={Math.min(300, 56 + limitsChartRows.length * 36)}>
                <BarChart data={limitsChartRows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 6" horizontal={false} stroke="#e8edf5" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} unit="%" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={88}
                    tick={{ fontSize: 11, fill: "#334155" }}
                    interval={0}
                  />
                  <Tooltip
                    formatter={(v: unknown, name: unknown) => [`${v}%`, name === "ss" ? "СС" : "ЭОМ"]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="ss" name="СС" fill={LIMIT_SS_COLOR} radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="eom" name="ЭОМ" fill={LIMIT_EOM_COLOR} radius={[0, 4, 4, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="muted homeChartEmpty">Нет загруженных лимитов с планом.</p>
            )}
          </section>

          <section className="homeChartCard">
            <header className="homeChartHead">
              <h3>Инструменты</h3>
              <span className="muted">статусы по объектам</span>
            </header>
            {toolsPieData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={toolsPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {toolsPieData.map((entry, i) => (
                      <Cell key={entry.key} fill={TOOL_PIE_COLORS[i % TOOL_PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={chartTooltipQty} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="muted homeChartEmpty">Инструменты не заведены.</p>
            )}
          </section>

          <section className="homeChartCard homeChartCardWide">
            <header className="homeChartHead">
              <h3>Городок и инструменты</h3>
              <span className="muted">по объектам</span>
            </header>
            {campChartRows.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={campChartRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#e8edf5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} interval={0} />
                  <YAxis width={36} tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
                  <Tooltip
                    formatter={chartTooltipQty}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="camp" name="Городок" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="tools" name="Инструменты" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="muted homeChartEmpty">Нет данных для сравнения.</p>
            )}
          </section>

          {topToolsRows.length > 1 ? (
            <section className="homeChartCard homeChartCardWide">
              <header className="homeChartHead">
                <h3>Топ категорий инструментов</h3>
                <span className="muted">суммарно по всем объектам</span>
              </header>
              <ResponsiveContainer width="100%" height={Math.min(220, 40 + topToolsRows.length * 28)}>
                <BarChart data={topToolsRows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 6" horizontal={false} stroke="#e8edf5" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "#334155" }} />
                  <Tooltip
                    formatter={chartTooltipQty}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
                    }
                  />
                  <Bar dataKey="count" name="Штук" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {loading && !objects.length ? <p className="muted">Загрузка…</p> : null}

      {!loading && sortedObjects.length > 0 ? (
        <section className="homePanel">
          <header className="homePanelHead">
            <h3>Объекты</h3>
            <span className="muted">проблемные выше · ▾ детали</span>
          </header>
          <div className="erpTableWrap">
            <table className="erpTable desktopTable">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Объект</th>
                  <th>СС</th>
                  <th>ЭОМ</th>
                  <th>Городок</th>
                  <th>Инструм.</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {sortedObjects.map((obj) => {
                  const expanded = expandedId === obj.warehouseId;
                  const camp = obj.campSs + obj.campEom;
                  const tone = objectRiskStatus(obj);
                  const rowClass =
                    highlightWarehouseId === obj.warehouseId
                      ? "rowHighlight"
                      : tone === "bad"
                        ? "rowBad"
                        : tone === "warn"
                          ? "rowRisk"
                          : "";
                  return (
                    <Fragment key={obj.warehouseId}>
                      <tr className={rowClass}>
                        <td>
                          <button
                            type="button"
                            className="erpRowToggle"
                            onClick={() => onExpand(expanded ? null : obj.warehouseId)}
                            aria-expanded={expanded}
                          >
                            {expanded ? "▾" : "▸"}
                          </button>
                        </td>
                        <td>
                          <strong>{obj.name}</strong>
                          {obj.stockLines > 0 ? (
                            <div className="muted" style={{ fontSize: 11 }}>
                              {obj.stockLines} поз. склада
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {obj.limitsSs.hasTemplate ? (
                            <button
                              type="button"
                              className="homeTableLink"
                              disabled={!canLimits}
                              onClick={() => canLimits && onOpenLimits(obj.warehouseId, "SS")}
                            >
                              {obj.limitsSs.percent}%
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {obj.limitsEom.hasTemplate ? (
                            <button
                              type="button"
                              className="homeTableLink"
                              disabled={!canLimits}
                              onClick={() => canLimits && onOpenLimits(obj.warehouseId, "EOM")}
                            >
                              {obj.limitsEom.percent}%
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{camp || "—"}</td>
                        <td>{obj.tools.total}</td>
                        <td>
                          <StatusBadge tone={tone}>{objectRiskLabel(tone)}</StatusBadge>
                        </td>
                        <td>
                          <div className="erpCellActions">
                            {canWarehouse ? (
                              <button type="button" className="ghostBtn" onClick={() => onOpenWarehouse?.(obj.warehouseId)}>
                                Склад
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr key={`${obj.warehouseId}-exp`} className="erpTableExpand">
                          <td colSpan={8}>
                            <div className="erpTableExpandInner">
                              {canCamp ? (
                                <button type="button" className="ghostBtn" onClick={() => onOpenCamp(obj.warehouseId)}>
                                  Городок ({camp})
                                </button>
                              ) : null}
                              {canLimits && obj.limitsSs.hasTemplate ? (
                                <button type="button" className="ghostBtn" onClick={() => onOpenLimits(obj.warehouseId, "SS")}>
                                  Лимиты СС
                                </button>
                              ) : null}
                              {canLimits && obj.limitsEom.hasTemplate ? (
                                <button type="button" className="ghostBtn" onClick={() => onOpenLimits(obj.warehouseId, "EOM")}>
                                  Лимиты ЭОМ
                                </button>
                              ) : null}
                              {canTools ? (
                                <button type="button" className="ghostBtn" onClick={() => onOpenTools(obj.warehouseId)}>
                                  Инструменты ({obj.tools.total})
                                </button>
                              ) : null}
                              {canOperations && obj.receiptOpen > 0 ? (
                                <button type="button" className="ghostBtn" onClick={() => onOpenOperations?.(obj.warehouseId)}>
                                  Приёмки ({obj.receiptOpen})
                                </button>
                              ) : null}
                              {obj.limitsSs.overCount + obj.limitsEom.overCount > 0 ? (
                                <span className="muted">Перерасход по лимитам</span>
                              ) : null}
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
        </section>
      ) : !loading && !error ? (
        <p className="muted">Нет доступных объектов для отображения.</p>
      ) : null}
        </div>

        <aside className="homeDashboardAside">{announcements}</aside>
      </div>
    </div>
  );
}
