export type StockMovementNavTarget =
  | { kind: "receipt"; receiptId: string }
  | { kind: "operation"; operationId: string }
  | { kind: "issue"; issueId: string }
  | { kind: "manual-batch"; batchId: string }
  | { kind: "transfer"; transferId: string };

export function movementNavLabel(
  m: {
    sourceDocumentType: string;
    sourceDocumentId?: string | null;
    operation?: { documentNumber?: string | null } | null;
    issueRequest?: { number?: string } | null;
  },
  fallback?: string
): string {
  if (m.issueRequest?.number) return m.issueRequest.number;
  if (m.operation?.documentNumber) return m.operation.documentNumber;
  if (m.sourceDocumentType === "RECEIPT_REQUEST" && m.sourceDocumentId) {
    return `Заявка ${m.sourceDocumentId.slice(0, 8)}`;
  }
  if (m.sourceDocumentType === "MANUAL_WAREHOUSE" || m.sourceDocumentType === "MANUAL_TOOL_CATALOG") {
    return "Ручное добавление";
  }
  if (m.sourceDocumentType === "TRANSFER_REQUEST") return "Перемещение";
  if (m.sourceDocumentType === "ISSUE_RETURN") return "Возврат с выдачи";
  return fallback || m.sourceDocumentType;
}

export function resolveStockMovementNav(m: {
  sourceDocumentType: string;
  sourceDocumentId?: string | null;
  operationId?: string | null;
  issueRequestId?: string | null;
}): StockMovementNavTarget | null {
  if (m.issueRequestId) return { kind: "issue", issueId: m.issueRequestId };
  if (m.sourceDocumentType === "RECEIPT_REQUEST" && m.sourceDocumentId) {
    return { kind: "receipt", receiptId: m.sourceDocumentId };
  }
  if (m.operationId) return { kind: "operation", operationId: m.operationId };
  if (m.sourceDocumentType === "OPERATION" && m.sourceDocumentId) {
    return { kind: "operation", operationId: m.sourceDocumentId };
  }
  if (
    (m.sourceDocumentType === "MANUAL_WAREHOUSE" || m.sourceDocumentType === "MANUAL_TOOL_CATALOG") &&
    m.sourceDocumentId
  ) {
    return { kind: "manual-batch", batchId: m.sourceDocumentId };
  }
  if (m.sourceDocumentType === "TRANSFER_REQUEST" && m.sourceDocumentId) {
    return { kind: "transfer", transferId: m.sourceDocumentId };
  }
  return null;
}
