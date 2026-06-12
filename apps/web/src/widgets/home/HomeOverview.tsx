import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StatusBadge, objectRiskLabel, objectRiskStatus } from "../../shared/ui/StatusBadge";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatMaterialQty } from "../../shared/quantity";
import { PageHero } from "../ui/PageHero";
import { MobileCard, MobileCardActions, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";
import { HomeDrillModal } from "./HomeDrillModal";
import { type HomeSection } from "./HomeSectionToggle";
import {
  HomeScrollChart,
  HomeScrollChartX,
  chartColumnsWidth,
  chartRowsHeight
} from "./HomeScrollChart";

export type HomeToolCategory = {
  key: string;
  label: string;
  icon: string | null;
  count: number;
  inStock: number;
  issued: number;
  inRepair: number;
};

export type HomeCampCategory = {
  key: string;
  label: string;
  icon: string | null;
  count: number;
};

export type HomeLimitSlice = {
  hasTemplate: boolean;
  plannedQty: number;
  issuedQty: number;
  arrivedQty: number;
  onOrderQty: number;
  percent: number;
  overCount: number;
};

export type HomeMovementTrendRow = {
  day: string;
  incomeSs: number;
  outcomeSs: number;
  incomeEom: number;
  outcomeEom: number;
  income: number;
  outcome: number;
};

export type HomeToolsBlock = {
  total: number;
  inStock: number;
  issued: number;
  inRepair: number;
  categories: HomeToolCategory[];
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
  stockLines: number;
  receiptOpen: number;
  toolsByCategory: HomeToolCategory[];
  toolsByCategorySs?: HomeToolCategory[];
  toolsByCategoryEom?: HomeToolCategory[];
  campByCategory: HomeCampCategory[];
  campByCategorySs?: HomeCampCategory[];
  campByCategoryEom?: HomeCampCategory[];
  movementTrend30d?: HomeMovementTrendRow[];
};

export type HomeObjectRow = {
  warehouseId: string;
  name: string;
  campSs: number;
  campEom: number;
  stockLines: number;
  stockLinesSs?: number;
  stockLinesEom?: number;
  receiptOpen: number;
  receiptOpenSs?: number;
  receiptOpenEom?: number;
  limitsSs: HomeLimitSlice;
  limitsEom: HomeLimitSlice;
  camp: {
    total: number;
    categories: HomeCampCategory[];
    categoriesSs?: HomeCampCategory[];
    categoriesEom?: HomeCampCategory[];
  };
  tools: HomeToolsBlock;
  toolsSs?: HomeToolsBlock;
  toolsEom?: HomeToolsBlock;
};

type Props = {
  objects: HomeObjectRow[];
  summary?: HomeOverviewSummary | null;
  loading: boolean;
  error: string;
  generatedAt?: string;
  expandedId: string | null;
  onExpand: (warehouseId: string | null) => void;
  onRefresh: () => void;
  /** Закрыть вложенные панели (карточка инструмента) при закрытии drill или «назад». */
  onDrillDismiss?: () => void;
  onOpenCamp: (warehouseId: string) => void;
  onOpenLimits: (warehouseId: string, section: "SS" | "EOM") => void;
  onOpenTools: (warehouseId: string) => void;
  onOpenWarehouse?: (warehouseId: string) => void;
  onOpenWarehouseTab?: () => void;
  onOpenLimitsTab?: () => void;
  onOpenToolsTab?: () => void;
  /** Каталог и таблица инструментов в модалке — только после выбора объекта. */
  renderToolsStatDrillContent?: (warehouseId: string, section: HomeSection) => ReactNode;
  renderCampStatDrillContent?: (warehouseId: string, section: HomeSection) => ReactNode;
  onToolsObjectDrill?: (warehouseId: string, section: HomeSection) => void;
  onCampObjectDrill?: (warehouseId: string) => void;
  onDrillSectionChange?: (section: HomeSection) => void;
  onOpenCampTab?: () => void;
  onOpenOperations?: (warehouseId: string) => void;
  onOpenOperationsTab?: () => void;
  canCamp?: boolean;
  canLimits?: boolean;
  canTools?: boolean;
  canWarehouse?: boolean;
  canOperations?: boolean;
  announcementsBell?: ReactNode;
  renderObjectDrillContent?: (params: {
    warehouseId: string;
    objectName: string;
    drillKind: "stat" | "chart";
    drillKey: string;
    drillSection: HomeSection;
  }) => ReactNode;
  onOpenQr?: () => void;
  onOpenIssues?: () => void;
  onOpenApprovals?: () => void;
  onCreateRequest?: () => void;
  onAcceptReturn?: () => void;
};

const CHART_PREVIEW_H = 280;
const CHART_MODAL_H = 520;

type HomeStatKey =
  | "limitsSs"
  | "limitsEom"
  | "stock"
  | "camp"
  | "tools"
  | "toolsStock"
  | "toolsIssued"
  | "toolsRepair"
  | "receipts";

type HomeChartKey = "movement" | "limits" | "toolsByObject" | "toolsStatus" | "camp" | "campCategories" | "categories";

type HomeDrill =
  | { kind: "stat"; key: HomeStatKey }
  | { kind: "chart"; key: HomeChartKey };

type DrillView =
  | { mode: "list" }
  | { mode: "object"; warehouseId: string };

function ChartCardHead({
  title,
  hint,
  count,
  onExpand
}: {
  title: string;
  hint: string;
  count?: number;
  onExpand: () => void;
}) {
  return (
    <header className="homeChartHead">
      <div>
        <h3>{title}</h3>
        <span className="muted">
          {hint}
          {count != null ? ` · ${count}` : ""}
        </span>
      </div>
      <button
        type="button"
        className="ghostBtn homeChartExpandBtn"
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
      >
        Развернуть
      </button>
    </header>
  );
}

function ObjectDrillTable({
  columns,
  rows,
  onRowClick
}: {
  columns: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  onRowClick?: (warehouseId: string) => void;
}) {
  if (!rows.length) return <p className="muted homeChartEmpty">Нет данных по объектам.</p>;
  const clickable = Boolean(onRowClick);
  return (
    <ResponsiveTableShell>
    <div className="erpTableWrap homeDrillTable">
      <table className="erpTable desktopTable">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className={clickable ? "homeDrillRow--clickable" : undefined}
              onClick={clickable ? () => onRowClick?.(r.key) : undefined}
            >
              {r.cells.map((cell, i) => (
                <td key={i} className={i === 0 && clickable ? "homeDrillObjectCell" : undefined}>
                  {i === 0 && clickable ? <span className="homeDrillObjectName">{cell}</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="mobileCards">
      {rows.map((r) => (
        <MobileCard
          key={`m-${r.key}`}
          className={clickable ? "homeDrillMobileCard--clickable" : undefined}
          onClick={clickable ? () => onRowClick?.(r.key) : undefined}
        >
          <h4>
            <span className="homeDrillObjectName">{r.cells[0]}</span>
          </h4>
          {r.cells.slice(1).map((cell, i) => (
            <MobileCardField key={i} label={columns[i + 1] || ""}>
              {cell}
            </MobileCardField>
          ))}
        </MobileCard>
      ))}
    </div>
    </ResponsiveTableShell>
  );
}

function HomeDrillByObjects({
  objectCount,
  chart,
  note,
  children
}: {
  objectCount: number;
  chart?: ReactNode;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="homeDrillStack">
      {chart ? <div className="homeDrillChartBlock">{chart}</div> : null}
      {note ? <p className="muted homeDrillNote">{note}</p> : null}
      <h4 className="homeDrillSectionTitle">По объектам · {objectCount}</h4>
      {children}
    </div>
  );
}

function pctCell(has: boolean, percent: number, over: number) {
  if (!has) return "отсутствует";
  return over > 0 ? `${percent}% ⚠` : `${percent}%`;
}
const LIMIT_SS_COLOR = "#4f46e5";
const LIMIT_EOM_COLOR = "#0ea5e9";

function fmtQty(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

function shortName(name: string, max = 14) {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function limitQtyPercent(qty: number, plannedQty: number): string {
  if (!(plannedQty > 0)) return "отсутствует";
  return `${Math.min(100, Math.round((qty / plannedQty) * 100))}%`;
}

function limitDrillCells(slice: HomeLimitSlice): ReactNode[] {
  if (!slice.hasTemplate) return ["отсутствует", "отсутствует", "отсутствует", "отсутствует"];
  return [
    `${slice.percent}%`,
    limitQtyPercent(slice.arrivedQty, slice.plannedQty),
    limitQtyPercent(slice.onOrderQty, slice.plannedQty),
    slice.overCount > 0 ? slice.overCount : "отсутствует"
  ];
}

function objectToolsBlock(o: HomeObjectRow, section: HomeSection): HomeToolsBlock {
  if (section === "SS" && o.toolsSs) return o.toolsSs;
  if (section === "EOM" && o.toolsEom) return o.toolsEom;
  return o.tools;
}

function objectLimitSlice(o: HomeObjectRow, section: HomeSection): HomeLimitSlice {
  return section === "SS" ? o.limitsSs : o.limitsEom;
}

function objectStockLines(o: HomeObjectRow, section: HomeSection): number {
  if (section === "SS" && o.stockLinesSs != null) return o.stockLinesSs;
  if (section === "EOM" && o.stockLinesEom != null) return o.stockLinesEom;
  return o.stockLines;
}

function objectReceiptOpen(o: HomeObjectRow, section: HomeSection): number {
  if (section === "SS" && o.receiptOpenSs != null) return o.receiptOpenSs;
  if (section === "EOM" && o.receiptOpenEom != null) return o.receiptOpenEom;
  return o.receiptOpen;
}

function objectCampCount(o: HomeObjectRow, section: HomeSection): number {
  return section === "SS" ? o.campSs : o.campEom;
}

function objectCampCategories(o: HomeObjectRow, section: HomeSection): HomeCampCategory[] {
  if (section === "SS" && o.camp.categoriesSs?.length) return o.camp.categoriesSs;
  if (section === "EOM" && o.camp.categoriesEom?.length) return o.camp.categoriesEom;
  return o.camp.categories;
}

function sectionLabel(section: HomeSection): string {
  return section === "SS" ? "СС" : "ЭОМ";
}

function chartTooltipQty(value: unknown): [string, string] {
  return [formatMaterialQty(value), ""];
}

export function HomeOverview({
  objects,
  summary,
  loading,
  error,
  generatedAt,
  expandedId,
  onExpand,
  onRefresh,
  onDrillDismiss,
  onOpenCamp,
  onOpenLimits,
  onOpenTools,
  onOpenWarehouse,
  onOpenWarehouseTab,
  onOpenLimitsTab,
  onOpenToolsTab,
  renderToolsStatDrillContent,
  onToolsObjectDrill,
  renderCampStatDrillContent,
  onCampObjectDrill,
  onOpenCampTab,
  onOpenOperations,
  onOpenOperationsTab,
  canCamp = true,
  canLimits = true,
  canTools = true,
  canWarehouse = true,
  canOperations = true,
  announcementsBell = null,
  renderObjectDrillContent,
  onDrillSectionChange,
  onOpenQr,
  onOpenIssues,
  onOpenApprovals,
  onCreateRequest,
  onAcceptReturn
}: Props) {
  const [drill, setDrill] = useState<HomeDrill | null>(null);
  const [drillSection, setDrillSection] = useState<HomeSection>("SS");
  const [drillHistory, setDrillHistory] = useState<DrillView[]>([{ mode: "list" }]);
  const [drillHistoryIndex, setDrillHistoryIndex] = useState(0);

  const selectDrillSection = (section: HomeSection) => {
    setDrillSection(section);
    onDrillSectionChange?.(section);
  };

  const openStatDrill = (key: HomeStatKey) => {
    setDrillSection(key === "limitsEom" ? "EOM" : "SS");
    onDrillSectionChange?.(key === "limitsEom" ? "EOM" : "SS");
    setDrill({ kind: "stat", key });
    setDrillHistory([{ mode: "list" }]);
    setDrillHistoryIndex(0);
  };
  const openChartDrill = (key: HomeChartKey) => {
    setDrillSection("SS");
    onDrillSectionChange?.("SS");
    setDrill({ kind: "chart", key });
    setDrillHistory([{ mode: "list" }]);
    setDrillHistoryIndex(0);
  };
  const drillView = drillHistory[drillHistoryIndex] || { mode: "list" as const };
  const selectedObject =
    drillView.mode === "object" ? objects.find((o) => o.warehouseId === drillView.warehouseId) || null : null;

  const drillToolsWarehouseId =
    drill?.kind === "stat" && drill.key === "tools" && drillView.mode === "object"
      ? drillView.warehouseId
      : null;

  const onToolsObjectDrillRef = useRef(onToolsObjectDrill);
  onToolsObjectDrillRef.current = onToolsObjectDrill;

  useEffect(() => {
    if (!drillToolsWarehouseId) return;
    onToolsObjectDrillRef.current?.(drillToolsWarehouseId, drillSection);
  }, [drillToolsWarehouseId, drillSection]);

  const openObjectMini = (warehouseId: string) => {
    if (drill?.kind === "stat" && drill.key === "camp") {
      onCampObjectDrill?.(warehouseId);
    }
    setDrillHistory((prev) => {
      const next = [...prev.slice(0, drillHistoryIndex + 1), { mode: "object", warehouseId } as DrillView];
      return next;
    });
    setDrillHistoryIndex((i) => i + 1);
  };
  const dismissDrill = () => {
    setDrill(null);
    onDrillDismiss?.();
  };
  const goBack = () => {
    onDrillDismiss?.();
    setDrillHistoryIndex((i) => Math.max(0, i - 1));
  };
  const goForward = () => setDrillHistoryIndex((i) => Math.min(drillHistory.length - 1, i + 1));
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
        .map((o) => ({
          id: o.warehouseId,
          name: shortName(o.name, 16),
          fullName: o.name,
          ss: o.limitsSs.hasTemplate && o.limitsSs.plannedQty > 0 ? o.limitsSs.percent : null,
          eom: o.limitsEom.hasTemplate && o.limitsEom.plannedQty > 0 ? o.limitsEom.percent : null,
          ssOver: o.limitsSs.overCount,
          eomOver: o.limitsEom.overCount
        }))
        .sort((a, b) => Math.max(b.ss ?? 0, b.eom ?? 0) - Math.max(a.ss ?? 0, a.eom ?? 0) || a.fullName.localeCompare(b.fullName, "ru")),
    [objects]
  );

  const campChartRows = useMemo(
    () =>
      objects
        .map((o) => ({
          id: o.warehouseId,
          name: shortName(o.name, 12),
          fullName: o.name,
          campSs: o.campSs,
          campEom: o.campEom,
          camp: o.campSs + o.campEom,
          tools: o.tools.total
        }))
        .sort((a, b) => b.camp - a.camp || b.tools - a.tools || a.fullName.localeCompare(b.fullName, "ru")),
    [objects]
  );

  const toolsStatusChartRows = useMemo(() => {
    const ssTools = summary?.toolsByCategorySs?.length
      ? summary.toolsByCategorySs
      : objects.flatMap((o) => o.toolsSs?.categories ?? []);
    const eomTools = summary?.toolsByCategoryEom?.length
      ? summary.toolsByCategoryEom
      : objects.flatMap((o) => o.toolsEom?.categories ?? []);
    const sumBlock = (items: HomeToolCategory[]) =>
      items.reduce(
        (acc, c) => ({
          inStock: acc.inStock + c.inStock,
          issued: acc.issued + c.issued,
          inRepair: acc.inRepair + c.inRepair
        }),
        { inStock: 0, issued: 0, inRepair: 0 }
      );
    const ss = sumBlock(ssTools);
    const eom = sumBlock(eomTools);
    if (!ss.inStock && !ss.issued && !ss.inRepair && !eom.inStock && !eom.issued && !eom.inRepair) {
      const inStock = summary?.toolsInStock ?? totals.toolsInStock;
      const issued = summary?.toolsIssued ?? totals.toolsIssued;
      const inRepair = summary?.toolsInRepair ?? totals.toolsInRepair;
      return [
        { name: "На складе", ss: inStock, eom: 0 },
        { name: "Выдано", ss: issued, eom: 0 },
        { name: "В ремонте", ss: inRepair, eom: 0 }
      ].filter((r) => r.ss > 0 || r.eom > 0);
    }
    return [
      { name: "На складе", ss: ss.inStock, eom: eom.inStock },
      { name: "Выдано", ss: ss.issued, eom: eom.issued },
      { name: "В ремонте", ss: ss.inRepair, eom: eom.inRepair }
    ].filter((r) => r.ss > 0 || r.eom > 0);
  }, [objects, summary, totals]);

  const movementChartRows = useMemo(() => {
    const src = summary?.movementTrend30d;
    if (!src?.length) return [];
    return src.map((r) => ({
      ...r,
      label: r.day.slice(5).replace("-", ".")
    }));
  }, [summary?.movementTrend30d]);

  const topToolsRows = useMemo(() => {
    const mergeCats = (ss: HomeToolCategory[], eom: HomeToolCategory[]) => {
      const map = new Map<string, { fullName: string; ss: number; eom: number }>();
      for (const c of ss) {
        const fullName = c.icon ? `${c.icon} ${c.label}` : c.label;
        map.set(c.key, { fullName, ss: c.count, eom: 0 });
      }
      for (const c of eom) {
        const fullName = c.icon ? `${c.icon} ${c.label}` : c.label;
        const prev = map.get(c.key);
        if (prev) prev.eom = c.count;
        else map.set(c.key, { fullName, ss: 0, eom: c.count });
      }
      return [...map.values()]
        .sort((a, b) => b.ss + b.eom - (a.ss + a.eom))
        .map((r) => ({
          name: shortName(r.fullName, 18),
          fullName: r.fullName,
          ss: r.ss,
          eom: r.eom,
          count: r.ss + r.eom
        }));
    };
    const ssSrc = summary?.toolsByCategorySs?.length
      ? summary.toolsByCategorySs
      : objects.flatMap((o) => o.toolsSs?.categories ?? []);
    const eomSrc = summary?.toolsByCategoryEom?.length
      ? summary.toolsByCategoryEom
      : objects.flatMap((o) => o.toolsEom?.categories ?? []);
    if (ssSrc.length || eomSrc.length) return mergeCats(ssSrc, eomSrc);
    const src = summary?.toolsByCategory?.length
      ? summary.toolsByCategory
      : objects.flatMap((o) => o.tools.categories);
    return [...src]
      .sort((a, b) => b.count - a.count)
      .map((c) => ({
        name: shortName(c.icon ? `${c.icon} ${c.label}` : c.label, 18),
        fullName: c.icon ? `${c.icon} ${c.label}` : c.label,
        ss: c.count,
        eom: 0,
        count: c.count
      }));
  }, [objects, summary]);

  const topCampRows = useMemo(() => {
    const mergeCats = (ss: HomeCampCategory[], eom: HomeCampCategory[]) => {
      const map = new Map<string, { fullName: string; ss: number; eom: number }>();
      for (const c of ss) {
        const fullName = c.icon ? `${c.icon} ${c.label}` : c.label;
        map.set(c.key, { fullName, ss: c.count, eom: 0 });
      }
      for (const c of eom) {
        const fullName = c.icon ? `${c.icon} ${c.label}` : c.label;
        const prev = map.get(c.key);
        if (prev) prev.eom = c.count;
        else map.set(c.key, { fullName, ss: 0, eom: c.count });
      }
      return [...map.values()]
        .sort((a, b) => b.ss + b.eom - (a.ss + a.eom))
        .map((r) => ({
          name: shortName(r.fullName, 18),
          fullName: r.fullName,
          ss: r.ss,
          eom: r.eom,
          count: r.ss + r.eom
        }));
    };
    const ssSrc = summary?.campByCategorySs?.length
      ? summary.campByCategorySs
      : objects.flatMap((o) => o.camp.categoriesSs ?? []);
    const eomSrc = summary?.campByCategoryEom?.length
      ? summary.campByCategoryEom
      : objects.flatMap((o) => o.camp.categoriesEom ?? []);
    if (ssSrc.length || eomSrc.length) return mergeCats(ssSrc, eomSrc);
    const src = summary?.campByCategory?.length
      ? summary.campByCategory
      : objects.flatMap((o) => o.camp?.categories ?? []);
    return [...src]
      .sort((a, b) => b.count - a.count)
      .map((c) => ({
        name: shortName(c.icon ? `${c.icon} ${c.label}` : c.label, 18),
        fullName: c.icon ? `${c.icon} ${c.label}` : c.label,
        ss: c.count,
        eom: 0,
        count: c.count
      }));
  }, [objects, summary]);

  const toolsByObjectRows = useMemo(
    () =>
      objects
        .map((o) => {
          const ss = o.toolsSs ?? o.tools;
          const eom = o.toolsEom ?? { total: 0, inStock: 0, issued: 0, inRepair: 0, categories: [] };
          return {
            id: o.warehouseId,
            name: shortName(o.name, 14),
            fullName: o.name,
            inStockSs: ss.inStock,
            issuedSs: ss.issued,
            inRepairSs: ss.inRepair,
            totalSs: ss.total,
            inStockEom: eom.inStock,
            issuedEom: eom.issued,
            inRepairEom: eom.inRepair,
            totalEom: eom.total,
            inStock: ss.inStock + eom.inStock,
            issued: ss.issued + eom.issued,
            inRepair: ss.inRepair + eom.inRepair,
            total: ss.total + eom.total
          };
        })
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName, "ru")),
    [objects]
  );

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

  const objectCount = summary?.objectCount ?? objects.length;

  const limitsChartH = chartRowsHeight(limitsChartRows.length);
  const toolsObjChartH = chartRowsHeight(toolsByObjectRows.length);
  const categoriesChartH = chartRowsHeight(topToolsRows.length);
  const campCategoriesChartH = chartRowsHeight(topCampRows.length);
  const campChartW = chartColumnsWidth(campChartRows.length);

  const drillTitle = drill
    ? drill.kind === "stat"
      ? ({
          limitsSs: "Лимиты СС по объектам",
          limitsEom: "Лимиты ЭОМ по объектам",
          stock: "ТМЦ на складе",
          camp: "Городок по объектам",
          tools: "Инструменты по объектам",
          toolsStock: "Инструменты на складе",
          toolsIssued: "Выданные инструменты",
          toolsRepair: "Инструменты в ремонте",
          receipts: "Приёмки в работе"
        } satisfies Record<HomeStatKey, string>)[drill.key]
      : ({
          movement: "Движение за 30 дней",
          limits: "Выполнение лимитов",
          toolsByObject: "Инструменты по объектам",
          toolsStatus: "Статусы инструментов",
          camp: "Городок по объектам",
          campCategories: "Категории городка",
          categories: "Категории инструментов"
        } satisfies Record<HomeChartKey, string>)[drill.key]
    : "";

  const drillDetails = (): (() => void) | undefined => {
    if (!drill) return undefined;
    if (drill.kind === "stat") {
      if (drill.key === "limitsSs" || drill.key === "limitsEom") return canLimits ? onOpenLimitsTab : undefined;
      if (drill.key === "stock") return onOpenWarehouseTab;
      if (drill.key === "receipts") return canOperations ? onOpenOperationsTab : undefined;
      if (drill.key === "camp") return canCamp ? onOpenCampTab : undefined;
      if (drill.key === "tools" || drill.key === "toolsStock" || drill.key === "toolsIssued" || drill.key === "toolsRepair") {
        return canTools ? onOpenToolsTab : undefined;
      }
    }
    if (drill.kind === "chart") {
      if (drill.key === "movement") return onOpenWarehouseTab;
      if (drill.key === "limits") return canLimits ? onOpenLimitsTab : undefined;
      if (drill.key === "camp") return canCamp ? onOpenCampTab : undefined;
      if (drill.key === "campCategories") return canCamp ? onOpenCampTab : undefined;
      if (drill.key === "toolsByObject" || drill.key === "toolsStatus" || drill.key === "categories") {
        return canTools ? onOpenToolsTab : undefined;
      }
    }
    return undefined;
  };

  const renderLimitsChart = (height: number, yWidth: number, useFullNames: boolean) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={
          useFullNames
            ? limitsChartRows.map((r) => ({ ...r, name: r.fullName }))
            : limitsChartRows
        }
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 6" horizontal={false} stroke="#e8edf5" />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} unit="%" />
        <YAxis type="category" dataKey="name" width={yWidth} tick={{ fontSize: 11, fill: "#334155" }} interval={0} />
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
  );

  const renderToolsByObjectChart = (height: number, yWidth: number, useFullNames: boolean, sectionFilter?: HomeSection) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={useFullNames ? toolsByObjectRows.map((r) => ({ ...r, name: r.fullName })) : toolsByObjectRows}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 6" horizontal={false} stroke="#e8edf5" />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={yWidth} tick={{ fontSize: 11, fill: "#334155" }} interval={0} />
        <Tooltip
          formatter={chartTooltipQty}
          labelFormatter={(_, payload) =>
            payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {sectionFilter ? (
          <>
            <Bar
              dataKey={sectionFilter === "SS" ? "inStockSs" : "inStockEom"}
              name="На складе"
              fill="#4f46e5"
              radius={[0, 4, 4, 0]}
              barSize={8}
            />
            <Bar
              dataKey={sectionFilter === "SS" ? "issuedSs" : "issuedEom"}
              name="Выдано"
              fill="#0ea5e9"
              radius={[0, 4, 4, 0]}
              barSize={8}
            />
            <Bar
              dataKey={sectionFilter === "SS" ? "inRepairSs" : "inRepairEom"}
              name="В ремонте"
              fill="#f59e0b"
              radius={[0, 4, 4, 0]}
              barSize={8}
            />
          </>
        ) : (
          <>
            <Bar dataKey="inStockSs" name="На складе СС" fill="#4f46e5" radius={[0, 4, 4, 0]} barSize={8} />
            <Bar dataKey="inStockEom" name="На складе ЭОМ" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={8} />
            <Bar dataKey="issuedSs" name="Выдано СС" fill="#0ea5e9" radius={[0, 4, 4, 0]} barSize={8} />
            <Bar dataKey="issuedEom" name="Выдано ЭОМ" fill="#38bdf8" radius={[0, 4, 4, 0]} barSize={8} />
            <Bar dataKey="inRepairSs" name="В ремонте СС" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={8} />
            <Bar dataKey="inRepairEom" name="В ремонте ЭОМ" fill="#fbbf24" radius={[0, 4, 4, 0]} barSize={8} />
          </>
        )}
      </BarChart>
    </ResponsiveContainer>
  );

  const renderCategoriesChart = (
    height: number,
    yWidth: number,
    useFullNames: boolean,
    rows = topToolsRows,
    sectionFilter?: HomeSection
  ) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={useFullNames ? rows.map((r) => ({ ...r, name: r.fullName })) : rows}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 6" horizontal={false} stroke="#e8edf5" />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={yWidth} tick={{ fontSize: 11, fill: "#334155" }} interval={0} />
        <Tooltip
          formatter={chartTooltipQty}
          labelFormatter={(_, payload) =>
            payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
          }
        />
        {sectionFilter ? (
          <Bar
            dataKey={sectionFilter === "SS" ? "ss" : "eom"}
            name={sectionLabel(sectionFilter)}
            fill={sectionFilter === "SS" ? LIMIT_SS_COLOR : LIMIT_EOM_COLOR}
            radius={[0, 6, 6, 0]}
            barSize={14}
          />
        ) : (
          <>
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="ss" name="СС" fill={LIMIT_SS_COLOR} radius={[0, 6, 6, 0]} barSize={12} />
            <Bar dataKey="eom" name="ЭОМ" fill={LIMIT_EOM_COLOR} radius={[0, 6, 6, 0]} barSize={12} />
          </>
        )}
      </BarChart>
    </ResponsiveContainer>
  );

  const renderCampChart = (_width: number, height: number, sectionFilter?: HomeSection) => (
    <ResponsiveContainer width="100%" height={height}>
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
        {sectionFilter ? (
          <Bar
            dataKey={sectionFilter === "SS" ? "campSs" : "campEom"}
            name={`Городок ${sectionLabel(sectionFilter)}`}
            fill={sectionFilter === "SS" ? LIMIT_SS_COLOR : LIMIT_EOM_COLOR}
            radius={[6, 6, 0, 0]}
          />
        ) : (
          <>
            <Bar dataKey="campSs" name="Городок СС" fill={LIMIT_SS_COLOR} radius={[6, 6, 0, 0]} />
            <Bar dataKey="campEom" name="Городок ЭОМ" fill={LIMIT_EOM_COLOR} radius={[6, 6, 0, 0]} />
          </>
        )}
      </BarChart>
    </ResponsiveContainer>
  );

  const renderMovementChart = (height: number, sectionFilter?: HomeSection) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={movementChartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={chartTooltipQty} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {sectionFilter ? (
          <>
            <Bar
              dataKey={sectionFilter === "SS" ? "incomeSs" : "incomeEom"}
              name="Приход"
              fill="#22c55e"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey={sectionFilter === "SS" ? "outcomeSs" : "outcomeEom"}
              name="Расход"
              fill="#f59e0b"
              radius={[4, 4, 0, 0]}
            />
          </>
        ) : (
          <>
            <Bar dataKey="incomeSs" name="Приход СС" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="outcomeSs" name="Расход СС" fill="#86efac" radius={[4, 4, 0, 0]} />
            <Bar dataKey="incomeEom" name="Приход ЭОМ" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            <Bar dataKey="outcomeEom" name="Расход ЭОМ" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </>
        )}
      </BarChart>
    </ResponsiveContainer>
  );

  const renderToolsStatusChart = (height: number, sectionFilter?: HomeSection) =>
    toolsStatusChartRows.length ? (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={toolsStatusChartRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#e8edf5" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
          <YAxis width={36} tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
          <Tooltip formatter={chartTooltipQty} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {sectionFilter ? (
            <Bar
              dataKey={sectionFilter === "SS" ? "ss" : "eom"}
              name={sectionLabel(sectionFilter)}
              fill={sectionFilter === "SS" ? LIMIT_SS_COLOR : LIMIT_EOM_COLOR}
              radius={[6, 6, 0, 0]}
            />
          ) : (
            <>
              <Bar dataKey="ss" name="СС" fill={LIMIT_SS_COLOR} radius={[6, 6, 0, 0]} />
              <Bar dataKey="eom" name="ЭОМ" fill={LIMIT_EOM_COLOR} radius={[6, 6, 0, 0]} />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    ) : (
      <p className="muted homeChartEmpty">Инструменты не заведены.</p>
    );

  const renderDrillBody = () => {
    if (!drill) return null;
    if (selectedObject) {
      const o = selectedObject;
      const customObjectDrill = renderObjectDrillContent?.({
        warehouseId: o.warehouseId,
        objectName: o.name,
        drillKind: drill.kind,
        drillKey: drill.key,
        drillSection
      });
      if (drill.kind === "stat" && drill.key === "tools" && renderToolsStatDrillContent) {
        return (
          <div className="homeDrillStack">
            <section className="homeDrillObjectBlock">
              <header className="homeDrillObjectBlockHead">
                <strong>{o.name}</strong>
                <span className="muted">инструменты объекта · {sectionLabel(drillSection)}</span>
              </header>
              {canTools ? (
                <div className="erpCellActions" style={{ marginBottom: 10 }}>
                  <button type="button" className="ghostBtn" onClick={() => onOpenTools(o.warehouseId)}>
                    Вкладка «Инструменты»
                  </button>
                </div>
              ) : null}
              {renderToolsStatDrillContent(o.warehouseId, drillSection)}
            </section>
          </div>
        );
      }
      if (drill.kind === "stat" && drill.key === "camp" && renderCampStatDrillContent) {
        return (
          <div className="homeDrillStack">
            <section className="homeDrillObjectBlock">
              <header className="homeDrillObjectBlockHead">
                <strong>{o.name}</strong>
                <span className="muted">городок объекта · {sectionLabel(drillSection)}</span>
              </header>
              {canCamp ? (
                <div className="erpCellActions" style={{ marginBottom: 10 }}>
                  <button type="button" className="ghostBtn" onClick={() => onOpenCamp(o.warehouseId)}>
                    Вкладка «Городок»
                  </button>
                </div>
              ) : null}
              {renderCampStatDrillContent(o.warehouseId, drillSection)}
            </section>
          </div>
        );
      }
      const tools = objectToolsBlock(o, drillSection);
      const limits = objectLimitSlice(o, drillSection);
      const miniRows = (() => {
        if (drill.kind === "stat") {
          if (drill.key === "limitsSs" || drill.key === "limitsEom") {
            return [
              { key: "exec", cells: ["Выполнение", limits.hasTemplate ? `${limits.percent}%` : "отсутствует"] },
              {
                key: "arr",
                cells: ["Приход", limits.hasTemplate ? limitQtyPercent(limits.arrivedQty, limits.plannedQty) : "отсутствует"]
              },
              {
                key: "ord",
                cells: ["В закупке", limits.hasTemplate ? limitQtyPercent(limits.onOrderQty, limits.plannedQty) : "отсутствует"]
              },
              { key: "over", cells: ["Перерасход", limits.overCount > 0 ? limits.overCount : "отсутствует"] }
            ];
          }
          if (drill.key === "stock") {
            return [{ key: "stock", cells: [`ТМЦ на складе (${sectionLabel(drillSection)})`, fmtQty(objectStockLines(o, drillSection))] }];
          }
          if (drill.key === "camp") {
            return [{ key: "camp", cells: [`Городок (${sectionLabel(drillSection)})`, objectCampCount(o, drillSection)] }];
          }
          if (drill.key === "tools") return [{ key: "tools", cells: [`Инструменты (${sectionLabel(drillSection)})`, tools.total] }];
          if (drill.key === "toolsStock") return [{ key: "tools-stock", cells: ["На складе", tools.inStock] }];
          if (drill.key === "toolsIssued") return [{ key: "tools-issued", cells: ["Выдано", tools.issued] }];
          if (drill.key === "toolsRepair") return [{ key: "tools-repair", cells: ["В ремонте", tools.inRepair] }];
          if (drill.key === "receipts") {
            return [{ key: "receipt", cells: [`Приёмки (${sectionLabel(drillSection)})`, objectReceiptOpen(o, drillSection)] }];
          }
        }
        if (drill.kind === "chart") {
          if (drill.key === "limits") {
            return [
              {
                key: "limits",
                cells: [`Лимиты ${sectionLabel(drillSection)}`, limits.hasTemplate ? `${limits.percent}%` : "отсутствует"]
              }
            ];
          }
          if (drill.key === "toolsByObject" || drill.key === "toolsStatus") {
            return [
              { key: "tools", cells: ["Инструменты", tools.total] },
              { key: "tools-stock", cells: ["На складе", tools.inStock] },
              { key: "tools-issued", cells: ["Выдано", tools.issued] },
              { key: "tools-repair", cells: ["В ремонте", tools.inRepair] }
            ];
          }
          if (drill.key === "movement") {
            return [
              { key: "stock", cells: [`ТМЦ (${sectionLabel(drillSection)})`, fmtQty(objectStockLines(o, drillSection))] },
              { key: "receipt", cells: [`Приёмки (${sectionLabel(drillSection)})`, objectReceiptOpen(o, drillSection)] }
            ];
          }
          if (drill.key === "camp") {
            return [{ key: "camp", cells: [`Городок (${sectionLabel(drillSection)})`, objectCampCount(o, drillSection)] }];
          }
          if (drill.key === "campCategories") {
            const cats = objectCampCategories(o, drillSection);
            return cats.length
              ? cats.map((c) => ({
                  key: `camp-${c.key}`,
                  cells: [c.icon ? `${c.icon} ${c.label}` : c.label, c.count]
                }))
              : [{ key: "camp-empty", cells: ["Категории", "отсутствует"] }];
          }
          if (drill.key === "categories") {
            return tools.categories.length
              ? tools.categories.map((c) => ({
                  key: `cat-${c.key}`,
                  cells: [c.icon ? `${c.icon} ${c.label}` : c.label, c.count]
                }))
              : [{ key: "cat-empty", cells: ["Категории", "отсутствует"] }];
          }
        }
        return [{ key: "fallback", cells: ["Данные", "отсутствует"] }];
      })();
      const miniColumns =
        drill.kind === "chart" && (drill.key === "categories" || drill.key === "campCategories")
          ? ["Категория", "Количество"]
          : ["Показатель", "Значение"];
      const contextActions = (
        <div className="erpCellActions" style={{ marginBottom: 10 }}>
          {(drill.kind === "stat" && (drill.key === "limitsSs" || drill.key === "limitsEom")) ||
          (drill.kind === "chart" && drill.key === "limits") ? (
            <>
              {canLimits ? (
                <button type="button" className="ghostBtn" onClick={() => onOpenLimits(o.warehouseId, "SS")}>
                  Лимиты СС
                </button>
              ) : null}
              {canLimits ? (
                <button type="button" className="ghostBtn" onClick={() => onOpenLimits(o.warehouseId, "EOM")}>
                  Лимиты ЭОМ
                </button>
              ) : null}
            </>
          ) : null}
          {(drill.kind === "stat" &&
            (drill.key === "tools" ||
              drill.key === "toolsStock" ||
              drill.key === "toolsIssued" ||
              drill.key === "toolsRepair")) ||
          (drill.kind === "chart" &&
            (drill.key === "toolsByObject" || drill.key === "toolsStatus" || drill.key === "categories")) ? (
            canTools ? (
              <button type="button" className="ghostBtn" onClick={() => onOpenTools(o.warehouseId)}>
                Вкладка «Инструменты»
              </button>
            ) : null
          ) : null}
          {(drill.kind === "stat" && drill.key === "stock") || (drill.kind === "chart" && drill.key === "movement") ? (
            canWarehouse ? (
              <button type="button" className="ghostBtn" onClick={() => onOpenWarehouse?.(o.warehouseId)}>
                Вкладка «Склад»
              </button>
            ) : null
          ) : null}
          {(drill.kind === "stat" && drill.key === "receipts") ? (
            canOperations ? (
              <button type="button" className="ghostBtn" onClick={() => onOpenOperations?.(o.warehouseId)}>
                Вкладка «Приходы»
              </button>
            ) : null
          ) : null}
          {(drill.kind === "stat" && drill.key === "camp") ||
          (drill.kind === "chart" && (drill.key === "camp" || drill.key === "campCategories")) ? (
            canCamp ? (
              <button type="button" className="ghostBtn" onClick={() => onOpenCamp(o.warehouseId)}>
                Вкладка «Городок»
              </button>
            ) : null
          ) : null}
        </div>
      );
      return (
        <div className="homeDrillStack">
          <section className="homeDrillObjectBlock">
            <header className="homeDrillObjectBlockHead">
              <strong>{o.name}</strong>
              <span className="muted">{customObjectDrill ? "дублирование вкладки" : "дубль данных из соответствующей вкладки"}</span>
            </header>
            {contextActions}
            {customObjectDrill ? customObjectDrill : <ObjectDrillTable columns={miniColumns} rows={miniRows} />}
          </section>
        </div>
      );
    }
    if (drill.kind === "stat") {
      if (drill.key === "limitsSs" || drill.key === "limitsEom") {
        return (
          <ObjectDrillTable
            columns={["Объект", "Выполнение", "Приход", "В закупке", "Перерасход"]}
            onRowClick={openObjectMini}
            rows={objects.map((o) => ({
              key: o.warehouseId,
              cells: [o.name, ...limitDrillCells(objectLimitSlice(o, drillSection))]
            }))}
          />
        );
      }
      if (drill.key === "stock") {
        return (
          <ObjectDrillTable
            columns={["Объект", `ТМЦ (${sectionLabel(drillSection)})`]}
            onRowClick={openObjectMini}
            rows={objects.map((o) => ({
              key: o.warehouseId,
              cells: [o.name, fmtQty(objectStockLines(o, drillSection))]
            }))}
          />
        );
      }
      if (drill.key === "camp") {
        return (
          <ObjectDrillTable
            columns={["Объект", `Городок (${sectionLabel(drillSection)})`]}
            onRowClick={openObjectMini}
            rows={objects.map((o) => ({
              key: o.warehouseId,
              cells: [o.name, objectCampCount(o, drillSection)]
            }))}
          />
        );
      }
      if (drill.key === "tools") {
        return (
          <ObjectDrillTable
            columns={["Объект", "Всего", "На складе", "Выдано", "В ремонте"]}
            onRowClick={openObjectMini}
            rows={objects.map((o) => {
              const t = objectToolsBlock(o, drillSection);
              return {
                key: o.warehouseId,
                cells: [o.name, t.total, t.inStock, t.issued, t.inRepair]
              };
            })}
          />
        );
      }
      if (drill.key === "toolsStock") {
        return (
          <ObjectDrillTable
            columns={["Объект", "На складе"]}
            onRowClick={openObjectMini}
            rows={objects.map((o) => ({
              key: o.warehouseId,
              cells: [o.name, objectToolsBlock(o, drillSection).inStock]
            }))}
          />
        );
      }
      if (drill.key === "toolsIssued") {
        return (
          <ObjectDrillTable
            columns={["Объект", "Выдано"]}
            onRowClick={openObjectMini}
            rows={objects.map((o) => ({
              key: o.warehouseId,
              cells: [o.name, objectToolsBlock(o, drillSection).issued]
            }))}
          />
        );
      }
      if (drill.key === "toolsRepair") {
        return (
          <ObjectDrillTable
            columns={["Объект", "В ремонте"]}
            onRowClick={openObjectMini}
            rows={objects.map((o) => ({
              key: o.warehouseId,
              cells: [o.name, objectToolsBlock(o, drillSection).inRepair]
            }))}
          />
        );
      }
      if (drill.key === "receipts") {
        return (
          <ObjectDrillTable
            columns={["Объект", `Приёмки (${sectionLabel(drillSection)})`]}
            onRowClick={openObjectMini}
            rows={objects.map((o) => ({
              key: o.warehouseId,
              cells: [o.name, objectReceiptOpen(o, drillSection)]
            }))}
          />
        );
      }
    }
    if (drill.kind === "chart") {
      if (drill.key === "movement") {
        return (
          <HomeDrillByObjects
            objectCount={objects.length}
            chart={
              movementChartRows.length ? (
                <HomeScrollChart height={220} maxPreview={CHART_MODAL_H}>
                  {renderMovementChart(220, drillSection)}
                </HomeScrollChart>
              ) : undefined
            }
            note={`График — движение (${sectionLabel(drillSection)}) за 30 дней. Ниже — показатели по каждому объекту.`}
          >
            <ObjectDrillTable
              columns={["Объект", `ТМЦ (${sectionLabel(drillSection)})`, `Приёмки (${sectionLabel(drillSection)})`]}
              onRowClick={openObjectMini}
              rows={objects.map((o) => ({
                key: o.warehouseId,
                cells: [o.name, fmtQty(objectStockLines(o, drillSection)), objectReceiptOpen(o, drillSection)]
              }))}
            />
          </HomeDrillByObjects>
        );
      }
      if (drill.key === "limits") {
        return (
          <HomeDrillByObjects objectCount={objects.length}>
            <ObjectDrillTable
              columns={["Объект", `Лимиты ${sectionLabel(drillSection)}`, "Перерасход"]}
              onRowClick={openObjectMini}
              rows={objects.map((o) => {
                const s = objectLimitSlice(o, drillSection);
                return {
                  key: o.warehouseId,
                  cells: [
                    o.name,
                    pctCell(s.hasTemplate, s.percent, s.overCount),
                    s.overCount > 0 ? s.overCount : "отсутствует"
                  ]
                };
              })}
            />
          </HomeDrillByObjects>
        );
      }
      if (drill.key === "toolsByObject") {
        return (
          <HomeDrillByObjects objectCount={objects.length}>
            <ObjectDrillTable
              columns={["Объект", "На складе", "Выдано", "В ремонте", "Всего"]}
              onRowClick={openObjectMini}
              rows={objects.map((o) => {
                const t = objectToolsBlock(o, drillSection);
                return {
                  key: o.warehouseId,
                  cells: [o.name, t.inStock, t.issued, t.inRepair, t.total]
                };
              })}
            />
          </HomeDrillByObjects>
        );
      }
      if (drill.key === "toolsStatus") {
        return (
          <HomeDrillByObjects
            objectCount={objects.length}
            chart={toolsStatusChartRows.length ? renderToolsStatusChart(240, drillSection) : undefined}
            note={`Статусы инструментов (${sectionLabel(drillSection)}). Таблица — разбивка по каждому объекту.`}
          >
            <ObjectDrillTable
              columns={["Объект", "На складе", "Выдано", "В ремонте", "Всего"]}
              onRowClick={openObjectMini}
              rows={objects.map((o) => {
                const t = objectToolsBlock(o, drillSection);
                return {
                  key: o.warehouseId,
                  cells: [o.name, t.inStock, t.issued, t.inRepair, t.total]
                };
              })}
            />
          </HomeDrillByObjects>
        );
      }
      if (drill.key === "camp") {
        return (
          <HomeDrillByObjects objectCount={objects.length}>
            <ObjectDrillTable
              columns={["Объект", `Городок (${sectionLabel(drillSection)})`]}
              onRowClick={openObjectMini}
              rows={objects.map((o) => ({
                key: o.warehouseId,
                cells: [o.name, objectCampCount(o, drillSection)]
              }))}
            />
          </HomeDrillByObjects>
        );
      }
      if (drill.key === "campCategories") {
        return (
          <HomeDrillByObjects
            objectCount={objects.length}
            note={`Категории имущества городка (${sectionLabel(drillSection)}) по объектам.`}
          >
            <div className="homeDrillObjectList">
              {objects.map((o) => (
                <section key={o.warehouseId} className="homeDrillObjectBlock">
                  <header className="homeDrillObjectBlockHead">
                    <strong>{o.name}</strong>
                    <span className="muted">{objectCampCount(o, drillSection)} поз.</span>
                  </header>
                  {objectCampCategories(o, drillSection).length ? (
                    <ObjectDrillTable
                      columns={["Категория", "Штук"]}
                      rows={objectCampCategories(o, drillSection).map((c) => ({
                        key: `${o.warehouseId}-${c.key}`,
                        cells: [c.icon ? `${c.icon} ${c.label}` : c.label, c.count]
                      }))}
                    />
                  ) : (
                    <p className="muted homeChartEmpty">Городок не заведён.</p>
                  )}
                </section>
              ))}
            </div>
            {topCampRows.length > 0 ? (
              <>
                <h4 className="homeDrillSectionTitle" style={{ marginTop: 16 }}>
                  Сводно · {sectionLabel(drillSection)}
                </h4>
                <ObjectDrillTable
                  columns={["Категория", "Штук"]}
                  rows={topCampRows
                    .filter((r) => (drillSection === "SS" ? r.ss : r.eom) > 0)
                    .map((r) => ({
                      key: r.fullName,
                      cells: [r.fullName, drillSection === "SS" ? r.ss : r.eom]
                    }))}
                />
              </>
            ) : null}
          </HomeDrillByObjects>
        );
      }
      if (drill.key === "categories") {
        return (
          <HomeDrillByObjects
            objectCount={objects.length}
            note={`Категории инструментов (${sectionLabel(drillSection)}) внутри каждого объекта.`}
          >
            <div className="homeDrillObjectList">
              {objects.map((o) => {
                const t = objectToolsBlock(o, drillSection);
                return (
                  <section key={o.warehouseId} className="homeDrillObjectBlock">
                    <header className="homeDrillObjectBlockHead">
                      <strong>{o.name}</strong>
                      <span className="muted">{t.total} инстр.</span>
                    </header>
                    {t.categories.length ? (
                      <ObjectDrillTable
                        columns={["Категория", "Всего", "На складе", "Выдано", "В ремонте"]}
                        rows={t.categories.map((c) => ({
                          key: `${o.warehouseId}-${c.key}`,
                          cells: [
                            c.icon ? `${c.icon} ${c.label}` : c.label,
                            c.count,
                            c.inStock,
                            c.issued,
                            c.inRepair
                          ]
                        }))}
                      />
                    ) : (
                      <p className="muted homeChartEmpty">Инструменты не заведены.</p>
                    )}
                  </section>
                );
              })}
            </div>
            {topToolsRows.length > 0 ? (
              <>
                <h4 className="homeDrillSectionTitle" style={{ marginTop: 16 }}>
                  Сводно · {sectionLabel(drillSection)}
                </h4>
                <ObjectDrillTable
                  columns={["Категория", "Штук"]}
                  rows={topToolsRows
                    .filter((r) => (drillSection === "SS" ? r.ss : r.eom) > 0)
                    .map((r) => ({
                      key: r.fullName,
                      cells: [r.fullName, drillSection === "SS" ? r.ss : r.eom]
                    }))}
                />
              </>
            ) : null}
          </HomeDrillByObjects>
        );
      }
    }
    return <p className="muted homeChartEmpty">Нет данных для отображения.</p>;
  };

  return (
    <div className="homeOverview tabShell">
      <PageHero
        variant="compact"
        icon="⌂"
        title="Главная"
        subtitle={
          <>
            {objectCount > 0 ? `${objectCount} объектов` : "Нет доступных объектов"} · сводка СС и ЭОМ по всем площадкам
            {generatedAt ? (
              <span className="homeOverviewMeta"> · обновлено {new Date(generatedAt).toLocaleTimeString()}</span>
            ) : null}
          </>
        }
        actions={
          <>
            {announcementsBell}
            <button type="button" className="ghostBtn" onClick={onRefresh} disabled={loading}>
              ↻ Обновить
            </button>
          </>
        }
        stats={[
          {
            label: "Лимиты СС",
            value: totals.ss.hasTemplate ? `${totals.ss.percent}%` : "отсутствует",
            tone: totals.ss.overCount > 0 ? "bad" : totals.ss.percent >= 80 ? "warn" : "ok",
            onClick: () => openStatDrill("limitsSs")
          },
          {
            label: "Лимиты ЭОМ",
            value: totals.eom.hasTemplate ? `${totals.eom.percent}%` : "отсутствует",
            tone: totals.eom.overCount > 0 ? "bad" : totals.eom.percent >= 80 ? "warn" : "ok",
            onClick: () => openStatDrill("limitsEom")
          },
          {
            label: "ТМЦ на складе",
            value: fmtQty(totals.stockLines),
            tone: "neutral",
            onClick: () => openStatDrill("stock")
          },
          {
            label: "Городок",
            value: totals.camp,
            tone: "neutral",
            onClick: () => openStatDrill("camp")
          },
          {
            label: "Инструменты",
            value: (
              <>
                <span>{totals.tools}</span>
                <small className="homeStatSubline">
                  склад {summary?.toolsInStock ?? totals.toolsInStock} · выдано {summary?.toolsIssued ?? totals.toolsIssued} ·
                  ремонт {summary?.toolsInRepair ?? totals.toolsInRepair}
                </small>
              </>
            ),
            tone: "neutral",
            onClick: () => openStatDrill("tools")
          },
          {
            label: "Приёмки",
            value: totals.receiptOpen,
            tone: totals.receiptOpen > 0 ? "warn" : "neutral",
            onClick: () => openStatDrill("receipts")
          }
        ]}
      />

      <div className="erpQuickActions">
        {canWarehouse && onOpenWarehouseTab ? (
          <button type="button" className="primaryBtn" onClick={onOpenWarehouseTab}>
            Склад
          </button>
        ) : null}
        {canLimits && onOpenLimitsTab ? (
          <button type="button" className="ghostBtn" onClick={onOpenLimitsTab}>
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
        {canTools && onOpenToolsTab ? (
          <button type="button" className="ghostBtn" onClick={onOpenToolsTab}>
            Инструменты
          </button>
        ) : null}
        {canCamp && onOpenCampTab ? (
          <button type="button" className="ghostBtn" onClick={onOpenCampTab}>
            Городок
          </button>
        ) : null}
        {canOperations && onOpenOperationsTab ? (
          <button type="button" className="ghostBtn" onClick={onOpenOperationsTab}>
            Приходы
          </button>
        ) : null}
        {onOpenQr ? (
          <button type="button" className="ghostBtn" onClick={onOpenQr}>
            QR-сканер
          </button>
        ) : null}
        {onAcceptReturn ? (
          <button type="button" className="ghostBtn" onClick={onAcceptReturn}>
            Принять возврат
          </button>
        ) : null}
      </div>

      {showCharts ? (
        <div className="homeChartsGrid">
          {movementChartRows.length > 0 ? (
            <section
              className="homeChartCard homeChartCardWide homeChartCardClickable"
              onClick={() => openChartDrill("movement")}
              role="presentation"
            >
              <ChartCardHead
                title="Движение за 30 дней"
                hint="приход и расход · СС и ЭОМ"
                count={movementChartRows.length}
                onExpand={() => openChartDrill("movement")}
              />
              <HomeScrollChart height={220} maxPreview={CHART_PREVIEW_H}>
                {renderMovementChart(220)}
              </HomeScrollChart>
            </section>
          ) : null}

          <section
            className="homeChartCard homeChartCardClickable"
            onClick={() => limitsChartRows.length && openChartDrill("limits")}
            role="presentation"
          >
            <ChartCardHead
              title="Выполнение лимитов"
              hint="СС и ЭОМ, % выдано / план"
              count={limitsChartRows.length}
              onExpand={() => openChartDrill("limits")}
            />
            {limitsChartRows.length ? (
              <HomeScrollChart height={limitsChartH} maxPreview={CHART_PREVIEW_H}>
                {renderLimitsChart(limitsChartH, 96, false)}
              </HomeScrollChart>
            ) : (
              <p className="muted homeChartEmpty">Нет загруженных лимитов с планом.</p>
            )}
          </section>

          <section
            className="homeChartCard homeChartCardClickable"
            onClick={() => toolsByObjectRows.length && openChartDrill("toolsByObject")}
            role="presentation"
          >
            <ChartCardHead
              title="Инструменты"
              hint="по объектам · СС и ЭОМ"
              count={toolsByObjectRows.length}
              onExpand={() => openChartDrill("toolsByObject")}
            />
            {toolsByObjectRows.length ? (
              <HomeScrollChart height={toolsObjChartH} maxPreview={CHART_PREVIEW_H}>
                {renderToolsByObjectChart(toolsObjChartH, 96, false)}
              </HomeScrollChart>
            ) : (
              <p className="muted homeChartEmpty">Инструменты не заведены.</p>
            )}
          </section>

          <section
            className="homeChartCard homeChartCardClickable"
            onClick={() => toolsStatusChartRows.length && openChartDrill("toolsStatus")}
            role="presentation"
          >
            <ChartCardHead
              title="Статусы инструментов"
              hint="сводно · СС и ЭОМ"
              count={toolsStatusChartRows.length}
              onExpand={() => openChartDrill("toolsStatus")}
            />
            {renderToolsStatusChart(220)}
          </section>

          <section
            className="homeChartCard homeChartCardWide homeChartCardClickable"
            onClick={() => campChartRows.length && openChartDrill("camp")}
            role="presentation"
          >
            <ChartCardHead
              title="Городок"
              hint="по объектам · СС и ЭОМ"
              count={campChartRows.length}
              onExpand={() => openChartDrill("camp")}
            />
            {campChartRows.length ? (
              <HomeScrollChartX width={campChartW} height={240} maxPreviewHeight={CHART_PREVIEW_H}>
                {renderCampChart(campChartW, 240)}
              </HomeScrollChartX>
            ) : (
              <p className="muted homeChartEmpty">Нет данных для сравнения.</p>
            )}
          </section>

          {topCampRows.length > 0 ? (
            <section
              className="homeChartCard homeChartCardWide homeChartCardClickable"
              onClick={() => openChartDrill("campCategories")}
              role="presentation"
            >
              <ChartCardHead
                title="Категории городка"
                hint="суммарно · СС и ЭОМ"
                count={topCampRows.length}
                onExpand={() => openChartDrill("campCategories")}
              />
              <HomeScrollChart height={campCategoriesChartH} maxPreview={CHART_PREVIEW_H}>
                {renderCategoriesChart(campCategoriesChartH, 110, false, topCampRows)}
              </HomeScrollChart>
            </section>
          ) : null}

          {topToolsRows.length > 0 ? (
            <section
              className="homeChartCard homeChartCardWide homeChartCardClickable"
              onClick={() => openChartDrill("categories")}
              role="presentation"
            >
              <ChartCardHead
                title="Категории инструментов"
                hint="суммарно · СС и ЭОМ"
                count={topToolsRows.length}
                onExpand={() => openChartDrill("categories")}
              />
              <HomeScrollChart height={categoriesChartH} maxPreview={CHART_PREVIEW_H}>
                {renderCategoriesChart(categoriesChartH, 110, false)}
              </HomeScrollChart>
            </section>
          ) : null}
        </div>
      ) : null}

      {drill ? (
        <HomeDrillModal
          title={drillTitle}
          size={
            drill.kind === "stat" && drill.key === "tools" && selectedObject
              ? "wide"
              : drill.kind === "stat" && drill.key === "camp" && selectedObject
                ? "wide"
                : drill.kind === "stat" && (drill.key === "limitsSs" || drill.key === "limitsEom")
                ? "wide"
                : drill.kind === "chart" && drill.key === "limits"
                  ? "wide"
                  : "default"
          }
          subtitle={
            drill.kind === "stat" && drill.key === "tools"
              ? selectedObject
                ? `${selectedObject.name} · разделы и таблица инструментов`
                : `${objectCount} объектов · выберите объект для детализации`
              : drill.kind === "stat" && drill.key === "camp"
                ? selectedObject
                  ? `${selectedObject.name} · категории и карточки городка`
                  : `${objectCount} объектов · выберите объект для детализации`
                : `${objectCount} объектов · детализация по каждому · «Подробнее» — переход в раздел`
          }
          onClose={dismissDrill}
          onBack={goBack}
          onForward={goForward}
          canBack={drillHistoryIndex > 0}
          canForward={drillHistoryIndex < drillHistory.length - 1}
          onDetails={drillDetails()}
          drillSection={drillSection}
          onDrillSectionChange={selectDrillSection}
        >
          {renderDrillBody()}
        </HomeDrillModal>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {loading && !objects.length ? <p className="muted">Загрузка…</p> : null}

      {!loading && sortedObjects.length > 0 ? (
        <section className="homePanel">
          <header className="homePanelHead">
            <h3>Объекты</h3>
            <span className="muted">проблемные выше · ▾ детали</span>
          </header>
          <ResponsiveTableShell>
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
                  const rowClass = tone === "bad" ? "rowBad" : tone === "warn" ? "rowRisk" : "";
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
                            "отсутствует"
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
                            "отсутствует"
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
          <div className="mobileCards">
            {sortedObjects.map((obj) => {
              const camp = obj.campSs + obj.campEom;
              const tone = objectRiskStatus(obj);
              return (
                <MobileCard key={`m-${obj.warehouseId}`}>
                  <h4>{obj.name}</h4>
                  <MobileCardField label="СС">
                    {obj.limitsSs.hasTemplate ? `${obj.limitsSs.percent}%` : "отсутствует"}
                  </MobileCardField>
                  <MobileCardField label="ЭОМ">
                    {obj.limitsEom.hasTemplate ? `${obj.limitsEom.percent}%` : "отсутствует"}
                  </MobileCardField>
                  <MobileCardField label="Городок">{camp || "—"}</MobileCardField>
                  <MobileCardField label="Инструм.">{obj.tools.total}</MobileCardField>
                  <MobileCardField label="Статус">
                    <StatusBadge tone={tone}>{objectRiskLabel(tone)}</StatusBadge>
                  </MobileCardField>
                  <MobileCardActions>
                    {canWarehouse ? (
                      <button type="button" className="ghostBtn" onClick={() => onOpenWarehouse?.(obj.warehouseId)}>
                        Склад
                      </button>
                    ) : null}
                    {canCamp ? (
                      <button type="button" className="ghostBtn" onClick={() => onOpenCamp(obj.warehouseId)}>
                        Городок
                      </button>
                    ) : null}
                    {canLimits && obj.limitsSs.hasTemplate ? (
                      <button type="button" className="ghostBtn" onClick={() => onOpenLimits(obj.warehouseId, "SS")}>
                        Лимиты СС
                      </button>
                    ) : null}
                    {canTools ? (
                      <button type="button" className="ghostBtn" onClick={() => onOpenTools(obj.warehouseId)}>
                        Инструменты
                      </button>
                    ) : null}
                  </MobileCardActions>
                </MobileCard>
              );
            })}
          </div>
          </ResponsiveTableShell>
        </section>
      ) : !loading && !error ? (
        <p className="muted">Нет доступных объектов для отображения.</p>
      ) : null}
    </div>
  );
}
