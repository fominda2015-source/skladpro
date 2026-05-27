import { useMemo } from "react";
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

export type HomeObjectRow = {
  warehouseId: string;
  name: string;
  campCount: number;
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
  canCamp?: boolean;
  canLimits?: boolean;
  canTools?: boolean;
};

function fmtQty(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

function limitTone(percent: number, overCount: number): "neutral" | "warn" | "bad" | "ok" {
  if (overCount > 0) return "bad";
  if (percent >= 100) return "ok";
  if (percent >= 80) return "warn";
  return "neutral";
}

export function HomeOverview({
  objects,
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
  canCamp = true,
  canLimits = true,
  canTools = true
}: Props) {
  const totals = useMemo(() => {
    let camp = 0;
    let planned = 0;
    let issued = 0;
    let tools = 0;
    for (const o of objects) {
      camp += o.campCount;
      planned += o.limits.plannedQty;
      issued += o.limits.issuedQty;
      tools += o.tools.total;
    }
    const pct = planned > 0 ? Math.min(100, Math.round((issued / planned) * 100)) : 0;
    return { camp, planned, issued, tools, pct };
  }, [objects]);

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
          { label: "Городок", value: totals.camp, tone: "neutral" },
          {
            label: "Лимиты",
            value: totals.planned > 0 ? `${totals.pct}%` : "—",
            tone: limitTone(totals.pct, objects.reduce((s, o) => s + o.limits.overCount, 0))
          },
          { label: "Инструменты", value: totals.tools, tone: "neutral" }
        ]}
      />

      {error ? <p className="error">{error}</p> : null}
      {loading && !objects.length ? <p className="muted">Загрузка…</p> : null}

      {!loading && !objects.length && !error ? (
        <p className="muted">Нет доступных объектов для отображения.</p>
      ) : null}

      <div className="homeObjectList">
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
                    {obj.tools.issued > 0 ? `выдано ${obj.tools.issued}` : "на складе"}
                  </span>
                </button>
              </div>

              {expanded ? (
                <div className="homeObjectDetail">
                  {obj.tools.categories.length ? (
                    <div className="homeDetailBlock">
                      <span className="homeDetailTitle">По категориям</span>
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
                      <p className="muted homeDetailFoot">
                        На складе {obj.tools.inStock} · выдано {obj.tools.issued}
                        {obj.tools.inRepair > 0 ? ` · в ремонте ${obj.tools.inRepair}` : ""}
                      </p>
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
