import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ToolsHubNav } from "./ToolsHubNav";
import { ToolCatalogMaterialsTable } from "./ToolCatalogMaterialsTable";
import {
  ELECTRIC_SUB_HUB_CARDS,
  TOOL_SUB_HUB_CARDS,
  TOOLS_HUB_CARDS,
  type ToolCatalogMaterialRow,
  type ToolCatalogSummary,
  type ToolsNavId,
  isMaterialNav,
  isToolListNav,
  navToCategorySlug,
  navToMaterialSection,
  toolsNavTitle
} from "./toolCatalog";

type Props = {
  navPath: ToolsNavId[];
  onNavPathChange: (path: ToolsNavId[]) => void;
  warehouseId: string;
  sectionFilter: "SS" | "EOM";
  token: string | null;
  apiUrl: string;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  toolListSlot: ReactNode;
  showHubOnly?: boolean;
};

export function ToolsCatalogWorkspace({
  navPath,
  onNavPathChange,
  warehouseId,
  sectionFilter,
  token,
  apiUrl,
  fetchWithSession,
  toolListSlot,
  showHubOnly
}: Props) {
  const current = navPath[navPath.length - 1] ?? "hub";
  const [summary, setSummary] = useState<ToolCatalogSummary | null>(null);
  const [materialRows, setMaterialRows] = useState<ToolCatalogMaterialRow[]>([]);
  const [matLoading, setMatLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      const q = new URLSearchParams();
      if (warehouseId) q.set("warehouseId", warehouseId);
      q.set("section", sectionFilter);
      const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/summary?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setSummary((await res.json()) as ToolCatalogSummary);
    })();
  }, [token, warehouseId, sectionFilter, apiUrl, fetchWithSession]);

  const materialSection = navToMaterialSection(current);

  useEffect(() => {
    if (!token || !materialSection) {
      setMaterialRows([]);
      return;
    }
    setMatLoading(true);
    const q = new URLSearchParams({ section: materialSection, sectionFilter });
    if (warehouseId) q.set("warehouseId", warehouseId);
    void fetchWithSession(`${apiUrl}/api/tools/catalog/materials?${q}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (res) => {
        if (res.ok) setMaterialRows((await res.json()) as ToolCatalogMaterialRow[]);
        else setMaterialRows([]);
      })
      .finally(() => setMatLoading(false));
  }, [token, materialSection, warehouseId, sectionFilter, apiUrl, fetchWithSession]);

  const hubStats = useMemo(
    () =>
      summary
        ? {
            tool: summary.toolManual,
            "tool-manual": summary.toolManual,
            "tool-electric": summary.toolElectric,
            "tool-electric-cordless": summary.toolElectricCordless,
            "tool-electric-corded": summary.toolElectricCorded,
            ppe: summary.ppe,
            "tool-consumable": summary.toolConsumable,
            kip: summary.kip,
            other: summary.other
          }
        : undefined,
    [summary]
  );

  function pushNav(id: ToolsNavId) {
    if (id === "hub") {
      onNavPathChange(["hub"]);
      return;
    }
    if (current === "hub") onNavPathChange(["hub", id]);
    else if (current === "tool" || id === "tool-manual" || id === "tool-electric") onNavPathChange([...navPath, id]);
    else if (current === "tool-electric" && (id === "tool-electric-cordless" || id === "tool-electric-corded"))
      onNavPathChange([...navPath, id]);
    else onNavPathChange([...navPath.slice(0, -1), id]);
  }

  function goBack() {
    if (navPath.length <= 1) onNavPathChange(["hub"]);
    else onNavPathChange(navPath.slice(0, -1));
  }

  const hubCards =
    current === "hub"
      ? TOOLS_HUB_CARDS
      : current === "tool"
        ? TOOL_SUB_HUB_CARDS
        : current === "tool-electric"
          ? ELECTRIC_SUB_HUB_CARDS
          : null;

  if (showHubOnly && current !== "hub") {
    return null;
  }

  return (
    <div className="toolsCatalogWorkspace">
      <nav className="toolsCatalogBreadcrumb toolbar" style={{ flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" className="ghostBtn" onClick={() => onNavPathChange(["hub"])}>
          Инструменты
        </button>
        {navPath.slice(1).map((seg, idx) => (
          <span key={`${seg}-${idx}`} className="muted">
            {" "}
            /{" "}
            <button
              type="button"
              className="ghostBtn"
              onClick={() => onNavPathChange(navPath.slice(0, idx + 2))}
            >
              {toolsNavTitle([seg])}
            </button>
          </span>
        ))}
        {navPath.length > 1 && (
          <button type="button" className="ghostBtn" style={{ marginLeft: "auto" }} onClick={goBack}>
            ← Назад
          </button>
        )}
      </nav>

      {hubCards && (
        <>
          <h3 style={{ marginTop: 0 }}>{toolsNavTitle(navPath)}</h3>
          <ToolsHubNav cards={hubCards} stats={hubStats} onSelect={pushNav} />
        </>
      )}

      {isMaterialNav(current) && (
        <>
          <h3 style={{ marginTop: hubCards ? 16 : 0 }}>{toolsNavTitle(navPath)}</h3>
          <ToolCatalogMaterialsTable rows={materialRows} loading={matLoading} />
        </>
      )}

      {isToolListNav(current) && navToCategorySlug(current) && (
        <>
          <h3 style={{ marginTop: hubCards ? 16 : 0 }}>{toolsNavTitle(navPath)}</h3>
          {toolListSlot}
        </>
      )}
    </div>
  );
}
