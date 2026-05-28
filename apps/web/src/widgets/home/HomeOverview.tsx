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

export type HomeLimitSlice = {
  hasTemplate: boolean;
  plannedQty: number;
  issuedQty: number;
  percent: number;
  overCount: number;
};

export type HomeOverviewSummary = {
  objectCount: number;
  campTotal: number;
  limitsSs: HomeLimitSlice;
  limitsEom: HomeLimitSlice;
  toolsTotal: number;
  toolsInStock: number;
  toolsIssued: number;
  toolsInRepair: number;
  toolsByCategory: HomeToolCategory[];
};

export type HomeObjectRow = {
  warehouseId: string;
  name: string;
  campSs: number;
  campEom: number;
  limitsSs: HomeLimitSlice;
  limitsEom: HomeLimitSlice;
};

type Props = {
  objects: HomeObjectRow[];
  highlightWarehouseId?: string;
  summary?: HomeOverviewSummary | null;
  loading: boolean;
  error: string;
  generatedAt?: string;
  onRefresh: () => void;
  onOpenCamp: (warehouseId: string) => void;
  onOpenLimits: (warehouseId: string, section: "SS" | "EOM") => void;
  onOpenTools: () => void;
  canCamp?: boolean;
  canLimits?: boolean;
  canTools?: boolean;
};

function fmtQty(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

function limitCell(slice: HomeLimitSlice) {
  if (!slice.hasTemplate) return { pct: "—", detail: "нет шаблона", tone: "muted" as const };
  const tone =
    slice.overCount > 0 ? ("bad" as const) : slice.percent >= 100 ? ("ok" as const) : slice.percent >= 80 ? ("warn" as const) : ("neutral" as const);
  return {
    pct: `${slice.percent}%`,
    detail: `${fmtQty(slice.issuedQty)} / ${fmtQty(slice.plannedQty)}`,
    tone
  };
}

function LimitPct({ slice }: { slice: HomeLimitSlice }) {
  const c = limitCell(slice);
  return (
    <span className={`homeTablePct tone-${c.tone}`} title={c.detail}>
      {c.pct}
    </span>
  );
}

export function HomeOverview({
  objects,
  highlightWarehouseId = "",
  summary,
  loading,
  error,
  generatedAt,
  onRefresh,
  onOpenCamp,
  onOpenLimits,
  onOpenTools,
  canCamp = true,
  canLimits = true,
  canTools = true
}: Props) {
  const tools = summary?.toolsByCategory ?? [];

  const heroStats = useMemo(() => {
    const ss = summary?.limitsSs;
    const eom = summary?.limitsEom;
    return [
      { label: "Объектов", value: objects.length, tone: "neutral" as const },
      {
        label: "Лимиты СС",
        value: ss?.hasTemplate ? `${ss.percent}%` : "—",
        tone: (ss && ss.overCount > 0 ? "bad" : "neutral") as "neutral" | "warn" | "bad" | "ok"
      },
      {
        label: "Лимиты ЭОМ",
        value: eom?.hasTemplate ? `${eom.percent}%` : "—",
        tone: (eom && eom.overCount > 0 ? "bad" : "neutral") as "neutral" | "warn" | "bad" | "ok"
      },
      { label: "Инструменты", value: summary?.toolsTotal ?? 0, tone: "neutral" as const }
    ];
  }, [objects.length, summary]);

  return (
    <div className="homeOverview">
      <PageHero
        variant="compact"
        icon="⌂"
        title="Главная"
        subtitle={
          <>
            Сводка по всем объектам · лимиты по разделам СС и ЭОМ
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
        stats={heroStats}
      />

      {error ? <p className="error">{error}</p> : null}
      {loading && !objects.length ? <p className="muted">Загрузка…</p> : null}

      {!loading && objects.length > 0 ? (
        <>
          <section className="homeTableSection">
            <header className="homeTableSectionHead">
              <h3>Лимиты по объектам</h3>
              <span className="muted">выполнение = выдано / план</span>
            </header>
            <div className="homeTableWrap">
              <table className="homeDataTable">
                <thead>
                  <tr>
                    <th>Объект</th>
                    <th colSpan={2}>СС</th>
                    <th colSpan={2}>ЭОМ</th>
                    <th>Городок</th>
                  </tr>
                  <tr className="homeDataTableSubhead">
                    <th />
                    <th>%</th>
                    <th>выдано / план</th>
                    <th>%</th>
                    <th>выдано / план</th>
                    <th>СС + ЭОМ</th>
                  </tr>
                </thead>
                <tbody>
                  {objects.map((obj) => {
                    const ss = limitCell(obj.limitsSs);
                    const eom = limitCell(obj.limitsEom);
                    const camp = obj.campSs + obj.campEom;
                    const highlighted = highlightWarehouseId === obj.warehouseId;
                    return (
                      <tr key={obj.warehouseId} className={highlighted ? "highlight" : ""}>
                        <td className="homeTableObject">
                          <strong>{obj.name}</strong>
                        </td>
                        <td>
                          {canLimits && obj.limitsSs.hasTemplate ? (
                            <button
                              type="button"
                              className={`homeTableLink tone-${ss.tone}`}
                              onClick={() => onOpenLimits(obj.warehouseId, "SS")}
                            >
                              <LimitPct slice={obj.limitsSs} />
                            </button>
                          ) : (
                            <LimitPct slice={obj.limitsSs} />
                          )}
                        </td>
                        <td className="muted homeTableDetail">{ss.detail}</td>
                        <td>
                          {canLimits && obj.limitsEom.hasTemplate ? (
                            <button
                              type="button"
                              className={`homeTableLink tone-${eom.tone}`}
                              onClick={() => onOpenLimits(obj.warehouseId, "EOM")}
                            >
                              <LimitPct slice={obj.limitsEom} />
                            </button>
                          ) : (
                            <LimitPct slice={obj.limitsEom} />
                          )}
                        </td>
                        <td className="muted homeTableDetail">{eom.detail}</td>
                        <td>
                          {canCamp && camp > 0 ? (
                            <button type="button" className="homeTableLink" onClick={() => onOpenCamp(obj.warehouseId)}>
                              {camp}
                            </button>
                          ) : (
                            camp || "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {summary ? (
                  <tfoot>
                    <tr className="homeDataTableFoot">
                      <td>
                        <strong>Итого</strong>
                      </td>
                      <td>
                        <LimitPct slice={summary.limitsSs} />
                      </td>
                      <td className="muted homeTableDetail">
                        {fmtQty(summary.limitsSs.issuedQty)} / {fmtQty(summary.limitsSs.plannedQty)}
                      </td>
                      <td>
                        <LimitPct slice={summary.limitsEom} />
                      </td>
                      <td className="muted homeTableDetail">
                        {fmtQty(summary.limitsEom.issuedQty)} / {fmtQty(summary.limitsEom.plannedQty)}
                      </td>
                      <td>{summary.campTotal}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>

          <section className="homeTableSection">
            <header className="homeTableSectionHead">
              <h3>Инструменты в общем</h3>
              <span className="muted">
                {summary
                  ? `всего ${summary.toolsTotal} · на складе ${summary.toolsInStock} · выдано ${summary.toolsIssued}${
                      summary.toolsInRepair > 0 ? ` · в ремонте ${summary.toolsInRepair}` : ""
                    }`
                  : ""}
              </span>
              {canTools ? (
                <button type="button" className="ghostBtn homeTableSectionAction" onClick={onOpenTools}>
                  Открыть модуль →
                </button>
              ) : null}
            </header>
            {tools.length ? (
              <div className="homeTableWrap">
                <table className="homeDataTable">
                  <thead>
                    <tr>
                      <th>Категория / тип</th>
                      <th>Всего</th>
                      <th>На складе</th>
                      <th>Выдано</th>
                      <th>В ремонте</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((c) => (
                      <tr key={c.key}>
                        <td>
                          {c.icon ? <span className="homeToolIcon" aria-hidden>{c.icon} </span> : null}
                          {c.label}
                        </td>
                        <td>
                          <strong>{c.count}</strong>
                        </td>
                        <td>{c.inStock}</td>
                        <td>{c.issued}</td>
                        <td>{c.inRepair > 0 ? c.inRepair : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  {summary ? (
                    <tfoot>
                      <tr className="homeDataTableFoot">
                        <td>
                          <strong>Итого</strong>
                        </td>
                        <td>
                          <strong>{summary.toolsTotal}</strong>
                        </td>
                        <td>{summary.toolsInStock}</td>
                        <td>{summary.toolsIssued}</td>
                        <td>{summary.toolsInRepair || "—"}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            ) : (
              <p className="muted homeTableEmpty">Инструменты не заведены.</p>
            )}
          </section>
        </>
      ) : null}

      {!loading && !objects.length && !error ? (
        <p className="muted">Нет доступных объектов для отображения.</p>
      ) : null}
    </div>
  );
}
