import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { API_URL } from "../../app/constants";
import { formatMaterialQty } from "../../shared/quantity";
import { LoadingState } from "../../shared/ui/StateViews";
import { LimitStructureBars } from "./LimitStructureBars";
import { limitNodeArrivedQty } from "./limitReceiptMetrics";

const metricFmt = (n: number) => formatMaterialQty(n);

export type LimitSection = "SS" | "EOM";

export type LimitImportNode = {
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

export type LimitImportTemplate = {
  id: string;
  warehouseId: string;
  section: LimitSection;
  title: string;
  nodes: LimitImportNode[];
};

export type LimitPickNode = {
  id: string;
  title: string;
  materialName?: string | null;
  unit?: string | null;
  plannedQty?: number | null;
};

type Props = {
  warehouseId: string;
  section: LimitSection;
  token: string | null;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  safeName: (v: string) => string;
  /** Режим выбора строки лимита (клик по материалу) */
  pickMode?: boolean;
  selectedNodeId?: string | null;
  onPickNode?: (node: LimitPickNode) => void;
  boundNodeIds?: ReadonlySet<string>;
};

export function LimitTreeExplorer({
  warehouseId,
  section,
  token,
  fetchWithSession,
  safeName,
  pickMode = false,
  selectedNodeId = null,
  onPickNode,
  boundNodeIds
}: Props) {
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

  useEffect(() => {
    if (!pickMode || !templates.length) return;
    const next: Record<string, boolean> = {};
    for (const tpl of templates) {
      for (const n of tpl.nodes) {
        if (n.nodeType === "GROUP") next[n.id] = true;
      }
    }
    setExpanded(next);
  }, [pickMode, templates]);

  const pickRowClass = (nodeId: string) => {
    if (!pickMode) return "";
    const parts = ["limitPickRow"];
    if (selectedNodeId === nodeId) parts.push("limitPickRow--selected");
    if (boundNodeIds?.has(nodeId)) parts.push("limitPickRow--bound");
    return parts.join(" ");
  };

  const handlePick = (node: LimitImportNode) => {
    if (!pickMode || node.nodeType !== "MATERIAL") return;
    onPickNode?.({
      id: node.id,
      title: node.title,
      materialName: node.materialName,
      unit: node.unit,
      plannedQty: node.plannedQty != null ? Number(node.plannedQty) : null
    });
  };

  const treeContent = useMemo(() => {
    if (loading) return <LoadingState text="Загрузка лимитов…" />;
    if (error) return <p className="muted">{error}</p>;
    if (!templates.length) return <p className="muted">Лимиты отсутствуют.</p>;

    return templates.slice(0, 1).map((tpl) => {
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
                          <tr
                            key={`mt-${node.id}-${m.id}`}
                            className={pickRowClass(m.id)}
                            onClick={pickMode ? () => handlePick(m) : undefined}
                            role={pickMode ? "button" : undefined}
                            tabIndex={pickMode ? 0 : undefined}
                            onKeyDown={
                              pickMode
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      handlePick(m);
                                    }
                                  }
                                : undefined
                            }
                          >
                            <td className="matName">
                              {safeName(String(m.materialName || m.title || ""))}
                              {boundNodeIds?.has(m.id) ? (
                                <span className="limitPickBoundBadge"> привязан</span>
                              ) : null}
                            </td>
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
          <div
            key={node.id}
            className={`limitMaterialRow ${isOver ? "low" : ""} ${pickRowClass(node.id)}`}
            style={{ marginLeft: depth * 10, marginTop: 6 }}
            onClick={pickMode ? () => handlePick(node) : undefined}
            role={pickMode ? "button" : undefined}
            tabIndex={pickMode ? 0 : undefined}
            onKeyDown={
              pickMode
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handlePick(node);
                    }
                  }
                : undefined
            }
          >
            <div className="rightCardHeader" style={{ marginBottom: 8, gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{safeName(nodeTitle)}</strong>
                <div className="muted">{node.unit || "шт"}</div>
                {boundNodeIds?.has(node.id) ? <span className="limitPickBoundBadge">привязан</span> : null}
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
    });
  }, [
    loading,
    error,
    templates,
    expanded,
    issuedByMaterial,
    supplyByMaterial,
    safeName,
    section,
    pickMode,
    selectedNodeId,
    boundNodeIds,
    onPickNode
  ]);

  return (
    <div className="homeDrillStack homeDrillTabEmbed limitsWorkspace">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <span className="muted">
          {pickMode ? "Кликните по строке материала в лимите" : null}
          {!pickMode ? (
            <>
              Раздел {section === "SS" ? "СС" : "ЭОМ"} · {templates.length ? "активный лимит" : "нет"}
              {templates.length > 1 ? ` · ${templates.length - 1} в архиве` : ""}
            </>
          ) : null}
        </span>
        <button type="button" className="ghostBtn" onClick={() => void load()}>
          ↻ Обновить
        </button>
      </div>
      {treeContent}
    </div>
  );
}
