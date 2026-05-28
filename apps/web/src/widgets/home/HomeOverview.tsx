import { useMemo } from "react";
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

export type HomeOverviewSummary = {
  objectCount: number;
  campTotal: number;
  limitsPlanned: number;
  limitsIssued: number;
  limitsPercent: number;
  limitsOverLines: number;
  objectsWithoutTemplate: number;
  toolsTotal: number;
  toolsInStock: number;
  toolsIssued: number;
  toolsInRepair: number;
  stockLines: number;
  receiptOpen: number;
  topToolCategories: HomeToolCategory[];
};

export type HomeObjectRow = {
  warehouseId: string;
  name: string;
  campCount: number;
  stockLines: number;
  receiptOpen: number;
  limits: {
    hasTemplate: boolean;
    plannedQty: number;
    issuedQty: number;
    percent: number;
    overCount: number;
  };
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
  summary?: HomeOverviewSummary | null;
  loading: boolean;
  error: string;
  sectionLabel: string;
  generatedAt?: string;
  expandedId: string | null;
  onExpand: (warehouseId: string | null) => void;
  onRefresh: () => void;
  onOpenCamp: (warehouseId: string) => void;
  onOpenLimits: (warehouseId: string) => void;
  onOpenTools: (warehouseId: string) => void;
  onOpenWarehouse?: (warehouseId: string) => void;
  onOpenOperations?: (warehouseId: string) => void;
  canCamp?: boolean;
  canLimits?: boolean;
  canTools?: boolean;
  canWarehouse?: boolean;
  canOperations?: boolean;
};

const TOOL_PIE_COLORS = ["#4f46e5", "#0ea5e9", "#f59e0b"] as const;
const LIMIT_BAR_COLORS = ["#4f46e5", "#6366f1", "#818cf8", "#a5b4fc"] as const;

function fmtQty(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

function shortName(name: string, max = 14) {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function limitTone(percent: number, overCount: number): "neutral" | "warn" | "bad" | "ok" {
  if (overCount > 0) return "bad";
  if (percent >= 100) return "ok";
  if (percent >= 80) return "warn";
  return "neutral";
}

function chartTooltipQty(value: unknown): [string, string] {
  const n = typeof value === "number" ? value : Number(value);
  return [Number.isFinite(n) ? n.toLocaleString("ru-RU") : "—", ""];
}

export function HomeOverview({
  objects,
  summary,
  loading,
  error,
  sectionLabel,
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
  canOperations = true
}: Props) {
  const totals = useMemo(() => {
    if (summary) {
      return {
        camp: summary.campTotal,
        planned: summary.limitsPlanned,
        issued: summary.limitsIssued,
        tools: summary.toolsTotal,
        pct: summary.limitsPercent,
        overLines: summary.limitsOverLines,
        stockLines: summary.stockLines,
        receiptOpen: summary.receiptOpen,
        toolsInRepair: summary.toolsInRepair,
        withoutTemplate: summary.objectsWithoutTemplate
      };
    }
    let camp = 0;
    let planned = 0;
    let issued = 0;
    let tools = 0;
    let overLines = 0;
    let stockLines = 0;
    let receiptOpen = 0;
    let toolsInRepair = 0;
    let withoutTemplate = 0;
    for (const o of objects) {
      camp += o.campCount;
      planned += o.limits.plannedQty;
      issued += o.limits.issuedQty;
      tools += o.tools.total;
      overLines += o.limits.overCount;
      stockLines += o.stockLines;
      receiptOpen += o.receiptOpen;
      toolsInRepair += o.tools.inRepair;
      if (!o.limits.hasTemplate) withoutTemplate += 1;
    }
    const pct = planned > 0 ? Math.min(100, Math.round((issued / planned) * 100)) : 0;
    return { camp, planned, issued, tools, pct, overLines, stockLines, receiptOpen, toolsInRepair, withoutTemplate };
  }, [objects, summary]);

  const limitsChartRows = useMemo(
    () =>
      objects
        .filter((o) => o.limits.hasTemplate && o.limits.plannedQty > 0)
        .map((o) => ({
          id: o.warehouseId,
          name: shortName(o.name, 18),
          fullName: o.name,
          percent: o.limits.percent,
          issued: o.limits.issuedQty,
          planned: o.limits.plannedQty,
          over: o.limits.overCount
        }))
        .sort((a, b) => b.percent - a.percent),
    [objects]
  );

  const campChartRows = useMemo(
    () =>
      objects
        .map((o) => ({
          id: o.warehouseId,
          name: shortName(o.name, 12),
          fullName: o.name,
          camp: o.campCount,
          tools: o.tools.total
        }))
        .filter((r) => r.camp > 0 || r.tools > 0)
        .sort((a, b) => b.camp - a.camp || b.tools - a.tools),
    [objects]
  );

  const toolsPieData = useMemo(() => {
    let inStock = 0;
    let issued = 0;
    let inRepair = 0;
    for (const o of objects) {
      inStock += o.tools.inStock;
      issued += o.tools.issued;
      inRepair += o.tools.inRepair;
    }
    if (summary) {
      inStock = summary.toolsInStock;
      issued = summary.toolsIssued;
      inRepair = summary.toolsInRepair;
    }
    return [
      { name: "На складе", value: inStock, key: "stock" },
      { name: "Выдано", value: issued, key: "issued" },
      { name: "В ремонте", value: inRepair, key: "repair" }
    ].filter((s) => s.value > 0);
  }, [objects, summary]);

  const topToolsRows = useMemo(() => {
    const src = summary?.topToolCategories?.length
      ? summary.topToolCategories
      : objects.flatMap((o) => o.tools.categories);
    const merged = new Map<string, HomeToolCategory>();
    for (const c of src) {
      const prev = merged.get(c.key);
      if (!prev) merged.set(c.key, { ...c });
      else {
        prev.count += c.count;
        prev.inStock += c.inStock;
        prev.issued += c.issued;
        prev.inRepair += c.inRepair;
      }
    }
    return [...merged.values()]
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
        onClick: canLimits && objects[0] ? () => onOpenLimits(objects[0].warehouseId) : undefined
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
    return items;
  }, [totals, objects, canLimits, canTools, canOperations, onOpenLimits, onOpenTools, onOpenOperations]);

  const showCharts = objects.length > 0 && !loading;

  return (
    <div className="homeOverview">
      <PageHero
        variant="compact"
        icon="⌂"
        title="Главная"
        subtitle={
          <>
            {sectionLabel}
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
          { label: "Объектов", value: objects.length, tone: "neutral" },
          { label: "Городок", value: totals.camp, tone: "neutral" },
          {
            label: "Лимиты",
            value: totals.planned > 0 ? `${totals.pct}%` : "—",
            tone: limitTone(totals.pct, totals.overLines)
          },
          { label: "Инструменты", value: totals.tools, tone: "neutral" }
        ]}
      />

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
          <section className="homeChartCard">
            <header className="homeChartHead">
              <h3>Выполнение лимитов</h3>
              <span className="muted">выдано / план, %</span>
            </header>
            {limitsChartRows.length ? (
              <ResponsiveContainer width="100%" height={Math.min(280, 48 + limitsChartRows.length * 32)}>
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
                    formatter={(v: unknown) => [`${v}%`, "Выполнение"]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
                    }
                  />
                  <Bar dataKey="percent" radius={[0, 6, 6, 0]} barSize={16}>
                    {limitsChartRows.map((row, i) => (
                      <Cell
                        key={row.id}
                        fill={row.over > 0 ? "#ef4444" : LIMIT_BAR_COLORS[i % LIMIT_BAR_COLORS.length]}
                      />
                    ))}
                  </Bar>
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
                <span className="muted">суммарно по выбранным объектам</span>
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

      {!loading && !objects.length && !error ? (
        <p className="muted">Нет доступных объектов для отображения.</p>
      ) : null}

      <div className="homeObjectList">
        <h3 className="homeObjectListTitle">По объектам</h3>
        {objects.map((obj) => {
          const expanded = expandedId === obj.warehouseId;
          const lt = limitTone(obj.limits.percent, obj.limits.overCount);
          return (
            <article key={obj.warehouseId} className={`homeObjectCard ${expanded ? "expanded" : ""}`}>
              <header className="homeObjectHead">
                <button
                  type="button"
                  className="homeObjectExpand"
                  onClick={() => onExpand(expanded ? null : obj.warehouseId)}
                  aria-expanded={expanded}
                  title={expanded ? "Свернуть" : "Подробнее"}
                >
                  {expanded ? "▾" : "▸"}
                </button>
                <span className="homeObjectName">{obj.name}</span>
                {obj.stockLines > 0 ? (
                  <span className="homeObjectMeta muted">{obj.stockLines} поз. склада</span>
                ) : null}
                {obj.receiptOpen > 0 ? (
                  <span className="homeObjectMeta warn">{obj.receiptOpen} приём.</span>
                ) : null}
              </header>

              <div className="homeObjectMetrics">
                <button
                  type="button"
                  className="homeMetric"
                  disabled={!canCamp}
                  onClick={() => canCamp && onOpenCamp(obj.warehouseId)}
                  title="Открыть городок"
                >
                  <span className="homeMetricLabel">Городок</span>
                  <span className="homeMetricValue">{obj.campCount}</span>
                  <span className="homeMetricHint muted">единиц</span>
                </button>

                <button
                  type="button"
                  className={`homeMetric tone-${lt}`}
                  disabled={!canLimits}
                  onClick={() => canLimits && onOpenLimits(obj.warehouseId)}
                  title="Открыть лимиты"
                >
                  <span className="homeMetricLabel">Лимиты</span>
                  <span className="homeMetricValue">
                    {obj.limits.hasTemplate ? `${obj.limits.percent}%` : "—"}
                  </span>
                  <span className="homeMetricHint muted">
                    {obj.limits.hasTemplate
                      ? `${fmtQty(obj.limits.issuedQty)} / ${fmtQty(obj.limits.plannedQty)}`
                      : "нет шаблона"}
                  </span>
                  {obj.limits.hasTemplate ? (
                    <span className="homeMetricBar" aria-hidden>
                      <span className="homeMetricBarFill" style={{ width: `${obj.limits.percent}%` }} />
                    </span>
                  ) : null}
                </button>

                <button
                  type="button"
                  className="homeMetric"
                  disabled={!canTools}
                  onClick={() => canTools && onOpenTools(obj.warehouseId)}
                  title="Открыть инструменты"
                >
                  <span className="homeMetricLabel">Инструменты</span>
                  <span className="homeMetricValue">{obj.tools.total}</span>
                  <span className="homeMetricHint muted">
                    склад {obj.tools.inStock} · выд. {obj.tools.issued}
                    {obj.tools.inRepair > 0 ? ` · рем. ${obj.tools.inRepair}` : ""}
                  </span>
                </button>
              </div>

              {expanded ? (
                <div className="homeObjectDetail">
                  {obj.tools.categories.length ? (
                    <div className="homeDetailBlock">
                      <span className="homeDetailTitle">Категории инструментов</span>
                      <ResponsiveContainer width="100%" height={Math.min(160, 28 + obj.tools.categories.length * 22)}>
                        <BarChart
                          data={obj.tools.categories.map((c) => ({
                            name: shortName(c.label, 14),
                            count: c.count
                          }))}
                          layout="vertical"
                          margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                        >
                          <XAxis type="number" hide />
                          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: "#64748b" }} />
                          <Bar dataKey="count" fill="#818cf8" radius={[0, 4, 4, 0]} barSize={12} />
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="homeToolChips">
                        {obj.tools.categories.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            className="homeToolChip"
                            disabled={!canTools}
                            onClick={() => canTools && onOpenTools(obj.warehouseId)}
                          >
                            {c.icon ? <span aria-hidden>{c.icon}</span> : null}
                            <span>{c.label}</span>
                            <strong>{c.count}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="muted homeDetailFoot">Инструменты не заведены.</p>
                  )}
                  {obj.limits.overCount > 0 ? (
                    <p className="homeDetailWarn">
                      Перерасход: {obj.limits.overCount}{" "}
                      {obj.limits.overCount === 1 ? "позиция" : "позиций"} сверх плана
                    </p>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
