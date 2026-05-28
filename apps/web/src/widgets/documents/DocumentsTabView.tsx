import type { ReactNode } from "react";
import { displayDocumentFileName, docTypeLabel } from "../../shared/fileName";
import { EmptyState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { FilterStrip, PageHero } from "../ui/PageHero";
import { TabShell } from "../layout/TabShell";

export type DocumentRow = {
  id: string;
  fileName: string;
  filePath: string;
  type: string;
  version: number;
  size?: number | null;
  entityType: string;
  entityId: string;
  createdAt: string;
};

type DocTypeTab = { id: string; label: string };

type Props = {
  objectFilter: ReactNode;
  documents: DocumentRow[];
  visibleDocs: DocumentRow[];
  selectedDocumentId: string;
  selectedDocument: DocumentRow | null;
  docPreviewUrl: string;
  apiUrl: string;
  docTypeTabs: DocTypeTab[];
  docTypeFilter: string;
  onDocTypeChange: (id: string) => void;
  docWarehouseFilter: string;
  warehouses: { id: string; name: string }[];
  onWarehouseChange: (id: string) => void;
  docEntityType: "" | "operation" | "issue" | "receipt";
  onEntityTypeChange: (t: "" | "operation" | "issue" | "receipt") => void;
  docEntityId: string;
  entitySelect: ReactNode;
  docSearchQuery: string;
  onSearchChange: (q: string) => void;
  filtersActive: boolean;
  onResetFilters: () => void;
  onRefresh: () => void;
  documentsMessage?: string;
  canWriteDocuments: boolean;
  onSelectPreview: (doc: DocumentRow) => void;
  onDelete: (id: string, shownName: string) => void;
  safeName: (n: string) => string;
};

export function DocumentsTabView({
  objectFilter,
  documents,
  visibleDocs,
  selectedDocumentId,
  selectedDocument,
  docPreviewUrl,
  apiUrl,
  docTypeTabs,
  docTypeFilter,
  onDocTypeChange,
  docWarehouseFilter,
  warehouses,
  onWarehouseChange,
  docEntityType,
  onEntityTypeChange,
  docEntityId,
  entitySelect,
  docSearchQuery,
  onSearchChange,
  filtersActive,
  onResetFilters,
  onRefresh,
  documentsMessage,
  canWriteDocuments,
  onSelectPreview,
  onDelete,
  safeName
}: Props) {
  return (
    <TabShell className="documentsTab">
      {objectFilter}
      <PageHero
        icon="▣"
        title="Документы"
        subtitle="Поиск и просмотр загруженных файлов"
        stats={[
          { label: "Найдено", value: visibleDocs.length },
          { label: "Всего", value: documents.length }
        ]}
        actions={
          <>
            <button type="button" className="ghostBtn" onClick={onRefresh}>
              ↻ Обновить
            </button>
            {filtersActive ? (
              <button type="button" className="ghostBtn" onClick={onResetFilters}>
                Сбросить
              </button>
            ) : null}
          </>
        }
      />

      <div className="tabs" style={{ flexWrap: "wrap" }}>
        {docTypeTabs.map((tab) => (
          <button
            key={tab.id || "all"}
            type="button"
            className={docTypeFilter === tab.id ? "active" : ""}
            onClick={() => onDocTypeChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FilterStrip
        search={
          <input
            value={docSearchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по имени файла…"
          />
        }
      >
        <select value={docWarehouseFilter} onChange={(e) => onWarehouseChange(e.target.value)} aria-label="Объект">
          <option value="">Все объекты</option>
          {warehouses.map((w) => (
            <option key={`doc-wh-${w.id}`} value={w.id}>
              {safeName(w.name)}
            </option>
          ))}
        </select>
        <select
          value={docEntityType}
          onChange={(e) => onEntityTypeChange((e.target.value || "") as "" | "operation" | "issue" | "receipt")}
          aria-label="Раздел"
        >
          <option value="">Все разделы</option>
          <option value="issue">Заявки на выдачу</option>
          <option value="operation">Операции</option>
          <option value="receipt">Приходные заявки</option>
        </select>
        {docEntityType ? entitySelect : null}
      </FilterStrip>

      {documentsMessage ? <p className="muted">{documentsMessage}</p> : null}

      <div className="docCenterSplit">
        <div className="erpTableWrap docCenterList">
          {!visibleDocs.length ? (
            <EmptyState
              title="Ничего не нашлось"
              hint={
                filtersActive
                  ? "Сбросьте фильтры или смените вид документа."
                  : "Файлы появятся после приёмки или выдачи."
              }
            />
          ) : (
            <table className="erpTable desktopTable">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Вид</th>
                  <th>Файл</th>
                  <th style={{ width: 72 }}>Размер</th>
                  <th style={{ width: 140 }} />
                </tr>
              </thead>
              <tbody>
                {visibleDocs.map((d) => {
                  const shownName = displayDocumentFileName(d.fileName, {
                    type: d.type,
                    createdAt: d.createdAt
                  });
                  return (
                    <tr
                      key={d.id}
                      className={selectedDocumentId === d.id ? "rowHighlight" : ""}
                      style={{ cursor: "pointer" }}
                      onClick={() => onSelectPreview(d)}
                    >
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                        {new Date(d.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <StatusBadge tone="doc">{docTypeLabel(d.type)}</StatusBadge>
                      </td>
                      <td title={d.fileName}>
                        <strong>{shownName}</strong>
                        <div className="muted" style={{ fontSize: 11 }}>
                          v{d.version} · {d.entityType}:{d.entityId.slice(0, 8)}…
                        </div>
                      </td>
                      <td className="muted">{d.size ? `${Math.max(1, Math.ceil(d.size / 1024))} КБ` : "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="erpCellActions">
                          <a
                            className="ghostBtn"
                            href={`${apiUrl}/${d.filePath}`}
                            target="_blank"
                            rel="noreferrer"
                            download={shownName}
                          >
                            Открыть
                          </a>
                          {canWriteDocuments ? (
                            <button type="button" className="ghostBtn" onClick={() => onDelete(d.id, shownName)}>
                              Удалить
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <aside className="homePanel docCenterPreview">
          <h3 style={{ margin: "0 0 8px" }}>Предпросмотр</h3>
          {selectedDocument ? (
            <>
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                {displayDocumentFileName(selectedDocument.fileName, {
                  type: selectedDocument.type,
                  createdAt: selectedDocument.createdAt
                })}{" "}
                · v{selectedDocument.version}
              </p>
              <iframe
                src={docPreviewUrl || `${apiUrl}/${selectedDocument.filePath}`}
                title="document-preview"
                style={{
                  width: "100%",
                  minHeight: 420,
                  border: "1px solid #e2e8f0",
                  borderRadius: 10
                }}
              />
            </>
          ) : (
            <p className="muted">Выберите файл в списке слева.</p>
          )}
        </aside>
      </div>
    </TabShell>
  );
}
