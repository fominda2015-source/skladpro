import type { ReactNode } from "react";
import { ToolsCatalogWorkspace } from "./ToolsCatalogWorkspace";
import type { ToolsNavId } from "./toolCatalog";

type Props = {
  navPath: ToolsNavId[];
  onNavPathChange: (path: ToolsNavId[]) => void;
  warehouseId: string;
  sectionFilter: "SS" | "EOM";
  token: string | null;
  apiUrl: string;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  toolListSlot: ReactNode;
  /** Не переключать вкладку при навигации по хабу (модалка на главной). */
  embedMode?: boolean;
  canWrite?: boolean;
  /** Группа в «Прочее» и смежных разделах — фильтр списка учётных единиц. */
  toolsListGroupFilter?: { categoryId: string; nameGroup: string; label: string } | null;
  onToolsListGroupFilterChange?: (
    filter: { categoryId: string; nameGroup: string; label: string } | null
  ) => void;
};

export function ToolsInventoryBlock({
  navPath,
  onNavPathChange,
  warehouseId,
  sectionFilter,
  token,
  apiUrl,
  fetchWithSession,
  toolListSlot,
  embedMode,
  canWrite,
  onCatalogMessage,
  toolsListGroupFilter,
  onToolsListGroupFilterChange
}: Props) {
  return (
    <div className={embedMode ? "toolsInventoryBlock toolsInventoryBlock--embed" : "toolsInventoryBlock"}>
      <ToolsCatalogWorkspace
        navPath={navPath}
        onNavPathChange={(path) => {
          onNavPathChange(path);
        }}
        warehouseId={warehouseId}
        sectionFilter={sectionFilter}
        token={token}
        apiUrl={apiUrl}
        fetchWithSession={fetchWithSession}
        toolListSlot={toolListSlot}
        canWrite={canWrite}
        onCatalogMessage={onCatalogMessage}
        toolsListGroupFilter={toolsListGroupFilter}
        onToolsListGroupFilterChange={onToolsListGroupFilterChange}
      />
    </div>
  );
}
