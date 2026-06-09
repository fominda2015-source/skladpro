import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ToolsCatalogNav } from "./ToolsCatalogNav";
import { ToolsHubNav } from "./ToolsHubNav";
import { ToolCatalogMaterialsTable } from "./ToolCatalogMaterialsTable";
import {
  ELECTRIC_SUB_HUB_CARDS,
  TOOL_SUB_HUB_CARDS,
  TOOLS_HUB_CARDS,
  buildToolsHubStats,
  catalogMaterialSectionLabel,
  type CatalogMaterialSection,
  type ToolCatalogMaterialRow,
  type ToolCatalogSummary,
  type ToolsNavId,
  isMaterialNav,
  navToMaterialSection,
  showToolsInventoryList,
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
  canWrite?: boolean;
  onCatalogMessage?: (msg: string, tone?: "success" | "error" | "neutral") => void;
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
  showHubOnly,
  canWrite,
  onCatalogMessage
}: Props) {
  const current = navPath[navPath.length - 1] ?? "hub";
  const [summary, setSummary] = useState<ToolCatalogSummary | null>(null);
  const [materialRows, setMaterialRows] = useState<ToolCatalogMaterialRow[]>([]);
  const [matLoading, setMatLoading] = useState(false);
  const [matRefresh, setMatRefresh] = useState(0);
  const [busyMaterialId, setBusyMaterialId] = useState<string | null>(null);

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
  }, [token, warehouseId, sectionFilter, apiUrl, fetchWithSession, matRefresh]);

  const materialSection = navToMaterialSection(current) as CatalogMaterialSection | null;

  const loadMaterials = useCallback(async () => {
    if (!token || !materialSection) {
      setMaterialRows([]);
      return;
    }
    setMatLoading(true);
    const q = new URLSearchParams({ section: materialSection, sectionFilter });
    if (warehouseId) q.set("warehouseId", warehouseId);
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/materials?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setMaterialRows((await res.json()) as ToolCatalogMaterialRow[]);
      else setMaterialRows([]);
    } finally {
      setMatLoading(false);
    }
  }, [token, materialSection, warehouseId, sectionFilter, apiUrl, fetchWithSession]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials, matRefresh]);

  const hubStats = useMemo(() => (summary ? buildToolsHubStats(summary) : undefined), [summary]);

  async function changeMaterialSection(materialId: string, section: CatalogMaterialSection | null) {
    if (!token || !canWrite) return;
    setBusyMaterialId(materialId);
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools/catalog/materials/${materialId}/section`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ toolCatalogSection: section })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        onCatalogMessage?.(body.error || "Не удалось изменить раздел", "error");
        return;
      }
      const label = section ? catalogMaterialSectionLabel(section) : "склад (без раздела инструментов)";
      onCatalogMessage?.(`Позиция перенесена: ${label}`, "success");
      setMatRefresh((n) => n + 1);
    } finally {
      setBusyMaterialId(null);
    }
  }

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
      <ToolsCatalogNav navPath={navPath} onNavPathChange={onNavPathChange} onBack={goBack} />

      {hubCards && (
        <>
          <h3 style={{ marginTop: 0 }}>{toolsNavTitle(navPath)}</h3>
          <ToolsHubNav cards={hubCards} stats={hubStats} onSelect={pushNav} />
        </>
      )}

      {isMaterialNav(current) && (
        <>
          <h3 style={{ marginTop: hubCards ? 16 : 0 }}>{toolsNavTitle(navPath)}</h3>
          <ToolCatalogMaterialsTable
            rows={materialRows}
            loading={matLoading}
            canWrite={canWrite}
            currentSection={materialSection}
            busyMaterialId={busyMaterialId}
            onChangeSection={changeMaterialSection}
          />
        </>
      )}

      {showToolsInventoryList(navPath) ? (
        <div className="toolsCatalogListSection" style={{ marginTop: hubCards ? 16 : 0 }}>
          {toolListSlot}
        </div>
      ) : null}
    </div>
  );
}
