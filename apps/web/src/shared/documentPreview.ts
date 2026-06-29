export type DocumentPreviewFile = {
  id: string;
  fileName: string;
  filePath: string;
  mimeType?: string | null;
  type?: string;
  title?: string | null;
};

export type DocumentPreviewKind = "pdf" | "image" | "text" | "office" | "spreadsheet" | "other";

export function documentFileUrl(apiUrl: string, filePath: string): string {
  return `${apiUrl}/${filePath}`;
}

export function detectDocumentPreviewKind(
  mimeType?: string | null,
  fileName?: string
): DocumentPreviewKind {
  const mime = (mimeType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();

  if (mime === "application/pdf" || mime === "application/x-pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(name)) {
    return "image";
  }
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    /\.(txt|csv|json|xml|log|md)$/i.test(name)
  ) {
    return "text";
  }
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    /\.(xls|xlsx|ods)$/i.test(name)
  ) {
    return "spreadsheet";
  }
  if (
    mime.includes("word") ||
    mime.includes("msword") ||
    mime.includes("opendocument.text") ||
    /\.(doc|docx|odt|rtf)$/i.test(name)
  ) {
    return "office";
  }
  return "other";
}

export function documentPreviewKindLabel(kind: DocumentPreviewKind): string {
  const map: Record<DocumentPreviewKind, string> = {
    pdf: "PDF",
    image: "Изображение",
    text: "Текст",
    office: "Документ Word",
    spreadsheet: "Таблица Excel",
    other: "Файл"
  };
  return map[kind];
}

export function isBrowserInlinePreview(kind: DocumentPreviewKind): boolean {
  return kind === "pdf" || kind === "image" || kind === "text";
}

export function collectDocumentSiblings<T extends DocumentPreviewFile & { entityType?: string; entityId?: string; groupId?: string | null }>(
  doc: T,
  all: T[]
): T[] {
  if (doc.groupId && doc.type === "inbound-manual") {
    return all
      .filter((d) => d.groupId === doc.groupId && d.type === "inbound-manual")
      .sort((a, b) => new Date((a as { createdAt?: string }).createdAt || 0).getTime() - new Date((b as { createdAt?: string }).createdAt || 0).getTime());
  }
  if (doc.entityType && doc.entityId) {
    const siblings = all.filter((d) => d.entityType === doc.entityType && d.entityId === doc.entityId);
    if (siblings.length > 1) {
      return siblings.sort(
        (a, b) =>
          new Date((a as { createdAt?: string }).createdAt || 0).getTime() -
          new Date((b as { createdAt?: string }).createdAt || 0).getTime()
      );
    }
  }
  return [doc];
}
