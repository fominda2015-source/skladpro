import type { FormEvent, ReactNode } from "react";
import { displayDocumentFileName, docTypeLabel, formatDocMoment } from "../../shared/fileName";
import { documentFileUrl } from "../../shared/documentPreview";
import { PendingFilesPicker } from "../../shared/PendingFilesPicker";
import { EmptyState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { FilterStrip } from "../ui/PageHero";
import { MobileCard, MobileCardActions, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";
import { DocumentFilePreview } from "./DocumentFilePreview";
import type { DocumentRow } from "./DocumentsTabView";

export type InboundDocumentRow = DocumentRow & {
  groupId?: string | null;
  title?: string | null;
  comment?: string | null;
  documentDate?: string | null;
  sourceKind?: "manual" | "receipt" | "operation";
  sourceLabel?: string;
};

export type InboundDocumentEntry =
  | { kind: "single"; doc: InboundDocumentRow }
  | { kind: "group"; groupId: string; docs: InboundDocumentRow[] };

type Props = {
  objectFilter?: ReactNode;
  documents: InboundDocumentRow[];
  visibleDocs: InboundDocumentEntry[];
  selectedDocumentId: string;
  selectedDocument: InboundDocumentRow | null;
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
  onDelete: (id: string, shownName: string, relatedIds?: string[]) => void;
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

export function groupInboundDocumentsForDisplay(docs: InboundDocumentRow[]): InboundDocumentEntry[] {
  const others: InboundDocumentEntry[] = [];
  const byGroup = new Map<string, InboundDocumentRow[]>();

  for (const d of docs) {
    const isManualBundle = d.sourceKind === "manual" && d.type === "inbound-manual" && d.groupId;
    if (isManualBundle) {
      const g = d.groupId!;
      const arr = byGroup.get(g) || [];
      arr.push(d);
      byGroup.set(g, arr);
    } else {
      others.push({ kind: "single", doc: d });
    }
  }

  const grouped: InboundDocumentEntry[] = [];
  for (const [groupId, groupDocs] of byGroup) {
    const sorted = groupDocs.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (sorted.length === 1) {
      grouped.push({ kind: "single", doc: sorted[0] });
    } else {
      grouped.push({ kind: "group", groupId, docs: sorted });
    }
  }

  return [...others, ...grouped].sort((a, b) => {
    const da = a.kind === "single" ? docSortDate(a.doc) : docSortDate(a.docs[0]);
    const db = b.kind === "single" ? docSortDate(b.doc) : docSortDate(b.docs[0]);
    return db - da;
  });
}

export function buildInboundVisibleList(docs: InboundDocumentRow[], search: string): InboundDocumentEntry[] {
  return groupInboundDocumentsForDisplay(filterInboundDocuments(docs, search));
}

function entryPrimaryDoc(entry: InboundDocumentEntry): InboundDocumentRow {
  return entry.kind === "single" ? entry.doc : entry.docs[0];
}

function entryFileCount(entry: InboundDocumentEntry): number {
  return entry.kind === "single" ? 1 : entry.docs.length;
}

function entryTotalSize(entry: InboundDocumentEntry): number {
  if (entry.kind === "single") return entry.doc.size || 0;
  return entry.docs.reduce((sum, d) => sum + (d.size || 0), 0);
}

function entryIds(entry: InboundDocumentEntry): string[] {
  return entry.kind === "single" ? [entry.doc.id] : entry.docs.map((d) => d.id);
}

function entryIsSelected(entry: InboundDocumentEntry, selectedDocumentId: string): boolean {
  return entryIds(entry).includes(selectedDocumentId);
}

function shownTitle(doc: InboundDocumentRow): string {
  return displayDocumentFileName(doc.fileName, {
    type: doc.type,
    createdAt: doc.createdAt,
    title: doc.title
  });
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

  function renderEntryRow(entry: InboundDocumentEntry, mobile: boolean) {
    const primary = entryPrimaryDoc(entry);
    const title = shownTitle(primary);
    const dateLabel = formatDocMoment(primary.documentDate || primary.createdAt);
    const fileCount = entryFileCount(entry);
    const totalSize = entryTotalSize(entry);
    const selected = entryIsSelected(entry, selectedDocumentId);
    const relatedIds = entry.kind === "group" ? entry.docs.map((d) => d.id) : undefined;

    if (mobile) {
      return (
        <MobileCard key={`m-inb-${primary.id}`} onClick={() => onSelectPreview(primary)}>
          <h4>
            {title}
            {fileCount > 1 ? (
              <span className="badge neutral" style={{ marginLeft: 6, fontSize: 11 }}>
                {fileCount} файла
              </span>
            ) : null}
          </h4>
          <MobileCardField label="Дата">{dateLabel}</MobileCardField>
          <MobileCardField label="Источник">{primary.sourceLabel || docTypeLabel(primary.type)}</MobileCardField>
          {primary.comment ? <MobileCardField label="Комментарий">{primary.comment}</MobileCardField> : null}
          {fileCount > 1 ? (
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {entry.kind === "group"
                ? entry.docs.map((d) => d.fileName).join(", ")
                : primary.fileName}
            </p>
          ) : null}
          <MobileCardActions>
            {entry.kind === "group"
              ? entry.docs.map((d) => (
                  <a
                    key={d.id}
                    className="ghostBtn"
                    href={documentFileUrl(apiUrl, d.filePath)}
                    target="_blank"
                    rel="noreferrer"
                    download={d.fileName}
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↓ {d.fileName}
                  </a>
                ))
              : (
                  <a
                    className="ghostBtn"
                    href={documentFileUrl(apiUrl, primary.filePath)}
                    target="_blank"
                    rel="noreferrer"
                    download={title}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Скачать
                  </a>
                )}
            {canWriteDocuments && primary.sourceKind === "manual" ? (
              <button
                type="button"
                className="ghostBtn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(primary.id, title, relatedIds);
                }}
              >
                Удалить
              </button>
            ) : null}
          </MobileCardActions>
        </MobileCard>
      );
    }

    return (
      <tr
        key={primary.id}
        className={selected ? "rowHighlight" : ""}
        style={{ cursor: "pointer" }}
        onClick={() => onSelectPreview(primary)}
      >
        <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{dateLabel}</td>
        <td>
          <StatusBadge tone="doc">{primary.sourceLabel || docTypeLabel(primary.type)}</StatusBadge>
        </td>
        <td title={primary.fileName}>
          <strong>{title}</strong>
          {fileCount > 1 ? (
            <span className="badge neutral" style={{ marginLeft: 6, fontSize: 11 }}>
              {fileCount} файла
            </span>
          ) : null}
          <div className="muted" style={{ fontSize: 11 }}>
            {docTypeLabel(primary.type)}
            {primary.sourceKind !== "manual" ? ` · ${primary.entityType}` : ""}
            {fileCount > 1 && entry.kind === "group"
              ? ` · ${entry.docs.map((d) => d.fileName).join(", ")}`
              : ""}
          </div>
        </td>
        <td className="muted" style={{ maxWidth: 220 }}>
          {primary.comment?.trim() || "—"}
        </td>
        <td className="muted">{totalSize ? `${Math.max(1, Math.ceil(totalSize / 1024))} КБ` : "—"}</td>
        <td onClick={(e) => e.stopPropagation()}>
          <div className="erpCellActions" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
            {entry.kind === "group"
              ? entry.docs.map((d) => (
                  <a
                    key={d.id}
                    className="ghostBtn"
                    href={documentFileUrl(apiUrl, d.filePath)}
                    target="_blank"
                    rel="noreferrer"
                    download={d.fileName}
                    title={d.fileName}
                    style={{ fontSize: 11, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    ↓ {d.fileName}
                  </a>
                ))
              : (
                  <a
                    className="ghostBtn"
                    href={documentFileUrl(apiUrl, primary.filePath)}
                    target="_blank"
                    rel="noreferrer"
                    download={title}
                  >
                    Скачать
                  </a>
                )}
            {canWriteDocuments && primary.sourceKind === "manual" ? (
              <button type="button" className="ghostBtn" onClick={() => onDelete(primary.id, title, relatedIds)}>
                Удалить
              </button>
            ) : null}
          </div>
        </td>
      </tr>
    );
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
          <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>
            Документ будет доступен на всех объектах, к которым у вас есть доступ.
          </p>
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
                  {visibleDocs.map((entry) => renderEntryRow(entry, false))}
                </tbody>
              </table>
              <div className="mobileCards">
                {visibleDocs.map((entry) => renderEntryRow(entry, true))}
              </div>
            </ResponsiveTableShell>
          )}
        </div>
        <aside className="homePanel docCenterPreview">
          <h3 style={{ margin: "0 0 8px" }}>Предпросмотр</h3>
          {selectedDocument ? (
            <>
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                {shownTitle(selectedDocument)} ·{" "}
                {formatDocMoment(selectedDocument.documentDate || selectedDocument.createdAt)}
              </p>
              {selectedDocument.comment ? (
                <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                  {selectedDocument.comment}
                </p>
              ) : null}
              <DocumentFilePreview
                file={selectedDocument}
                apiUrl={apiUrl}
                allFiles={documents}
                onSelectFile={onSelectPreview}
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
