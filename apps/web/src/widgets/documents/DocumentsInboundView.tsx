import type { FormEvent, ReactNode } from "react";
import { displayDocumentFileName, docTypeLabel, formatDocMoment } from "../../shared/fileName";
import { PendingFilesPicker } from "../../shared/PendingFilesPicker";
import { EmptyState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { FilterStrip } from "../ui/PageHero";
import { MobileCard, MobileCardActions, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";
import type { DocumentRow } from "./DocumentsTabView";

export type InboundDocumentRow = DocumentRow & {
  title?: string | null;
  comment?: string | null;
  documentDate?: string | null;
  sourceKind?: "manual" | "receipt" | "operation";
  sourceLabel?: string;
};

type Props = {
  objectFilter?: ReactNode;
  documents: InboundDocumentRow[];
  visibleDocs: InboundDocumentRow[];
  selectedDocumentId: string;
  selectedDocument: InboundDocumentRow | null;
  docPreviewUrl: string;
  apiUrl: string;
  warehouseReady: boolean;
  docSearchQuery: string;
  onSearchChange: (q: string) => void;
  filtersActive: boolean;
  onResetFilters: () => void;
  onRefresh: () => void;
  documentsMessage?: string;
  canWriteDocuments: boolean;
  onSelectPreview: (doc: InboundDocumentRow) => void;
  onDelete: (id: string, shownName: string) => void;
  uploadTitle: string;
  onUploadTitleChange: (v: string) => void;
  uploadComment: string;
  onUploadCommentChange: (v: string) => void;
  uploadDate: string;
  onUploadDateChange: (v: string) => void;
  uploadFiles: File[];
  onUploadFilesChange: (files: File[]) => void;
  uploadBusy: boolean;
  onUpload: () => void;
};

function docSortDate(doc: InboundDocumentRow): number {
  const raw = doc.documentDate || doc.createdAt;
  return new Date(raw).getTime();
}

export function sortInboundDocuments(docs: InboundDocumentRow[]): InboundDocumentRow[] {
  return docs.slice().sort((a, b) => docSortDate(b) - docSortDate(a));
}

export function filterInboundDocuments(docs: InboundDocumentRow[], search: string): InboundDocumentRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) => {
    const shown = displayDocumentFileName(d.fileName, {
      type: d.type,
      createdAt: d.createdAt,
      title: d.title
    });
    const hay = [
      shown,
      d.fileName,
      d.title || "",
      d.comment || "",
      d.sourceLabel || "",
      docTypeLabel(d.type)
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function DocumentsInboundView({
  objectFilter,
  documents,
  visibleDocs,
  selectedDocumentId,
  selectedDocument,
  docPreviewUrl,
  apiUrl,
  warehouseReady,
  docSearchQuery,
  onSearchChange,
  filtersActive,
  onResetFilters,
  onRefresh,
  documentsMessage,
  canWriteDocuments,
  onSelectPreview,
  onDelete,
  uploadTitle,
  onUploadTitleChange,
  uploadComment,
  onUploadCommentChange,
  uploadDate,
  onUploadDateChange,
  uploadFiles,
  onUploadFilesChange,
  uploadBusy,
  onUpload
}: Props) {
  function onSubmitUpload(e: FormEvent) {
    e.preventDefault();
    onUpload();
  }

  return (
    <>
      {objectFilter}
      <FilterStrip
        search={
          <input
            value={docSearchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по названию, комментарию, файлу…"
          />
        }
      >
        <button type="button" className="ghostBtn" onClick={onRefresh}>
          ↻ Обновить
        </button>
        {filtersActive ? (
          <button type="button" className="ghostBtn" onClick={onResetFilters}>
            Сбросить
          </button>
        ) : null}
      </FilterStrip>

      {canWriteDocuments ? (
        <div className="card adminInsetCard" style={{ marginBottom: 12 }}>
          <h4 style={{ marginTop: 0 }}>Добавить документ вручную</h4>
          <form className="form" onSubmit={onSubmitUpload}>
            <div className="grid2">
              <label>
                Название
                <input
                  value={uploadTitle}
                  onChange={(e) => onUploadTitleChange(e.target.value)}
                  placeholder="Например: УПД от поставщика"
                  required
                />
              </label>
              <label>
                Дата документа
                <input
                  type="date"
                  value={uploadDate}
                  onChange={(e) => onUploadDateChange(e.target.value)}
                  required
                />
              </label>
            </div>
            <label>
              Комментарий
              <textarea
                value={uploadComment}
                onChange={(e) => onUploadCommentChange(e.target.value)}
                rows={2}
                placeholder="Пояснение, номер счёта, поставщик…"
              />
            </label>
            <label>
              Файлы
              <PendingFilesPicker
                files={uploadFiles}
                onChange={onUploadFilesChange}
                addLabel="Добавить файлы"
              />
            </label>
            {canWriteDocuments && !warehouseReady ? (
              <p className="muted">Выберите объект в шапке страницы, чтобы добавить документ.</p>
            ) : null}
            <div className="toolbar">
              <button
                type="submit"
                className="primaryBtn"
                disabled={uploadBusy || !warehouseReady || !uploadTitle.trim() || uploadFiles.length < 1}
              >
                {uploadBusy ? "Загрузка…" : "Добавить"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {documentsMessage ? <p className="muted">{documentsMessage}</p> : null}

      <div className="docCenterSplit">
        <div className="erpTableWrap docCenterList">
          {!visibleDocs.length ? (
            <EmptyState
              title="Нет документов по приходам"
              hint={
                filtersActive
                  ? "Сбросьте фильтры или измените поисковый запрос."
                  : "Здесь появятся файлы из заявок и приходов, а также документы, добавленные вручную."
              }
            />
          ) : (
            <ResponsiveTableShell>
              <table className="erpTable desktopTable">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Источник</th>
                    <th>Название</th>
                    <th>Комментарий</th>
                    <th style={{ width: 72 }}>Размер</th>
                    <th style={{ width: 140 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleDocs.map((d) => {
                    const shownName = displayDocumentFileName(d.fileName, {
                      type: d.type,
                      createdAt: d.createdAt,
                      title: d.title
                    });
                    const dateLabel = formatDocMoment(d.documentDate || d.createdAt);
                    return (
                      <tr
                        key={d.id}
                        className={selectedDocumentId === d.id ? "rowHighlight" : ""}
                        style={{ cursor: "pointer" }}
                        onClick={() => onSelectPreview(d)}
                      >
                        <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{dateLabel}</td>
                        <td>
                          <StatusBadge tone="doc">{d.sourceLabel || docTypeLabel(d.type)}</StatusBadge>
                        </td>
                        <td title={d.fileName}>
                          <strong>{shownName}</strong>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {docTypeLabel(d.type)}
                            {d.sourceKind !== "manual" ? ` · ${d.entityType}` : ""}
                          </div>
                        </td>
                        <td className="muted" style={{ maxWidth: 220 }}>
                          {d.comment?.trim() || "—"}
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
                            {canWriteDocuments && d.sourceKind === "manual" ? (
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
              <div className="mobileCards">
                {visibleDocs.map((d) => {
                  const shownName = displayDocumentFileName(d.fileName, {
                    type: d.type,
                    createdAt: d.createdAt,
                    title: d.title
                  });
                  return (
                    <MobileCard key={`m-inb-${d.id}`} onClick={() => onSelectPreview(d)}>
                      <h4>{shownName}</h4>
                      <MobileCardField label="Дата">
                        {formatDocMoment(d.documentDate || d.createdAt)}
                      </MobileCardField>
                      <MobileCardField label="Источник">{d.sourceLabel || docTypeLabel(d.type)}</MobileCardField>
                      {d.comment ? <MobileCardField label="Комментарий">{d.comment}</MobileCardField> : null}
                      <MobileCardActions>
                        <a
                          className="ghostBtn"
                          href={`${apiUrl}/${d.filePath}`}
                          target="_blank"
                          rel="noreferrer"
                          download={shownName}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Открыть
                        </a>
                        {canWriteDocuments && d.sourceKind === "manual" ? (
                          <button
                            type="button"
                            className="ghostBtn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(d.id, shownName);
                            }}
                          >
                            Удалить
                          </button>
                        ) : null}
                      </MobileCardActions>
                    </MobileCard>
                  );
                })}
              </div>
            </ResponsiveTableShell>
          )}
        </div>
        <aside className="homePanel docCenterPreview">
          <h3 style={{ margin: "0 0 8px" }}>Предпросмотр</h3>
          {selectedDocument ? (
            <>
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                {displayDocumentFileName(selectedDocument.fileName, {
                  type: selectedDocument.type,
                  createdAt: selectedDocument.createdAt,
                  title: selectedDocument.title
                })}{" "}
                · {formatDocMoment(selectedDocument.documentDate || selectedDocument.createdAt)}
              </p>
              {selectedDocument.comment ? (
                <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                  {selectedDocument.comment}
                </p>
              ) : null}
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
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Всего в подборке: {visibleDocs.length}
        {documents.length !== visibleDocs.length ? ` из ${documents.length}` : ""}
      </p>
    </>
  );
}
