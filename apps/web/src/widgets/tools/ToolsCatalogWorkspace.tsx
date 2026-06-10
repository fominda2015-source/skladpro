import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ToolsCatalogNav } from "./ToolsCatalogNav";
import { ToolsHubNav } from "./ToolsHubNav";
import { ToolCatalogMaterialCards } from "./ToolCatalogMaterialCards";
import { ToolCatalogMaterialDetailModal } from "./ToolCatalogMaterialDetailModal";
import { ToolConsumablesCatalogSection } from "./ToolConsumablesCatalogSection";
import {
  ELECTRIC_SUB_HUB_CARDS,
  TOOL_SUB_HUB_CARDS,
  TOOLS_HUB_CARDS,
  buildToolsHubStats,
  catalogMaterialSectionLabel,
  navToCategorySlug,
  type CatalogMaterialSection,
  type ToolCatalogMaterialRow,
  type ToolCatalogSummary,
  type ToolsNavId,
  isMaterialNav,
  isConsumableCatalogNav,
  isPureMaterialCatalogNav,
  navToMaterialSection,
  showToolsInventoryList,
  toolsNavTitle,
  usesToolNameGroupCards
} from "./toolCatalog";
import { ToolsCategoryTable, type ToolGroupCardRow } from "./ToolsCategoryTable";

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
  toolsListGroupFilter?: { categoryId: string; nameGroup: string; label: string } | null;
  onToolsListGroupFilterChange?: (
    filter: { categoryId: string; nameGroup: string; label: string } | null
  ) => void;
  onAddCatalogItem?: () => void;
  catalogRefreshNonce?: number;
  recipientSuggestions?: string[];
  safeName?: (name: string) => string;
  onConsumableDrawerChange?: (open: boolean) => void;
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
  onCatalogMessage,
  toolsListGroupFilter = null,
  onToolsListGroupFilterChange,
  onAddCatalogItem,
  catalogRefreshNonce = 0,
  recipientSuggestions = [],
  safeName = (n) => n,
  onConsumableDrawerChange
}: Props) {
  const current = navPath[navPath.length - 1] ?? "hub";
  const [summary, setSummary] = useState<ToolCatalogSummary | null>(null);
  const [materialRows, setMaterialRows] = useState<ToolCatalogMaterialRow[]>([]);
  const [matLoading, setMatLoading] = useState(false);
  const [matRefresh, setMatRefresh] = useState(0);
  const [busyMaterialId, setBusyMaterialId] = useState<string | null>(null);
  const [groupCards, setGroupCards] = useState<ToolGroupCardRow[]>([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<ToolCatalogMaterialRow | null>(null);

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
  }, [loadMaterials, matRefresh, catalogRefreshNonce]);

  useEffect(() => {
    if (!usesToolNameGroupCards(current)) {
      setGroupCards([]);
      return;
    }
    if (!token) return;
    const slug = navToCategorySlug(current);
    if (!slug) return;
    let cancelled = false;
    setGroupLoading(true);
    void (async () => {
      const q = new URLSearchParams({ section: sectionFilter });
      if (warehouseId) q.set("warehouseId", warehouseId);
      q.set("categorySlug", slug);
      try {
        const res = await fetchWithSession(`${apiUrl}/api/tools/by-category?${q}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!cancelled && res.ok) {
          setGroupCards((await res.json()) as ToolGroupCardRow[]);
        } else if (!cancelled) {
          setGroupCards([]);
        }
      } finally {
        if (!cancelled) setGroupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, token, warehouseId, sectionFilter, apiUrl, fetchWithSession, matRefresh]);

  const showGroupCards = usesToolNameGroupCards(current) && !toolsListGroupFilter;
  const showToolList =
    showToolsInventoryList(navPath) &&
    !isPureMaterialCatalogNav(current) &&
    (!usesToolNameGroupCards(current) || Boolean(toolsListGroupFilter));

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

      {isConsumableCatalogNav(current) && (
        <ToolConsumablesCatalogSection
          warehouseId={warehouseId}
          sectionFilter={sectionFilter}
          token={token}
          apiUrl={apiUrl}
          fetchWithSession={fetchWithSession}
          canWrite={canWrite}
          onAddCatalogItem={onAddCatalogItem}
          onCatalogMessage={onCatalogMessage}
          catalogRefreshNonce={catalogRefreshNonce}
          recipientSuggestions={recipientSuggestions}
          safeName={safeName}
          onDrawerOpenChange={onConsumableDrawerChange}
        />
      )}

      {isMaterialNav(current) && !isConsumableCatalogNav(current) && (
        <>
          <div className="toolbar" style={{ marginTop: hubCards ? 16 : 0, alignItems: "center" }}>
            <h3 style={{ margin: 0, flex: 1 }}>{toolsNavTitle(navPath)}</h3>
            {canWrite && onAddCatalogItem ? (
              <button type="button" className="primaryBtn" onClick={onAddCatalogItem}>
                + Добавить
              </button>
            ) : null}
          </div>
          {canWrite && materialRows.length > 0 && !matLoading ? (
            <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
              Нажмите на карточку — откроется остаток и действия с разделом.
            </p>
          ) : null}
          <ToolCatalogMaterialCards
            rows={materialRows}
            loading={matLoading}
            onOpen={setSelectedMaterial}
          />
          {selectedMaterial ? (
            <ToolCatalogMaterialDetailModal
              row={selectedMaterial}
              currentSection={materialSection}
              canWrite={canWrite}
              busy={busyMaterialId === selectedMaterial.materialId}
              onClose={() => setSelectedMaterial(null)}
              onChangeSection={async (materialId, section) => {
                await changeMaterialSection(materialId, section);
                setSelectedMaterial(null);
              }}
            />
          ) : null}
        </>
      )}

      {showGroupCards ? (
        <div style={{ marginTop: hubCards || isMaterialNav(current) ? 16 : 0 }}>
          <h3 style={{ marginTop: 0 }}>Учётные единицы</h3>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
            Выберите группу — откроется список с карточками инструментов (инв. №, QR, выдача).
          </p>
          {groupLoading ? (
            <p className="muted">Загрузка групп…</p>
          ) : groupCards.length ? (
            <ToolsCategoryTable
              cards={groupCards}
              onOpen={(card) => {
                if (!card.categoryId) return;
                onToolsListGroupFilterChange?.({
                  categoryId: card.categoryId,
                  nameGroup: card.label,
                  label: card.label
                });
              }}
            />
          ) : (
            <p className="muted">Учётные единицы в этом разделе не заведены.</p>
          )}
        </div>
      ) : null}

      {showToolList ? (
        <div className="toolsCatalogListSection" style={{ marginTop: hubCards || isMaterialNav(current) || showGroupCards ? 16 : 0 }}>
          {toolsListGroupFilter ? (
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <button type="button" className="ghostBtn" onClick={() => onToolsListGroupFilterChange?.(null)}>
                ← К группам
              </button>
              <span className="muted">{toolsListGroupFilter.label}</span>
            </div>
          ) : null}
          {toolListSlot}
        </div>
      ) : null}
    </div>
  );
}
