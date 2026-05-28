import { StatusBadge } from "../../shared/ui/StatusBadge";
import { receiptStatusLabel, receiptStatusTone } from "../receipts/receiptLabels";

export type ApprovalIssueRow = {
  id: string;
  number: string;
  warehouse?: { name?: string } | null;
  warehouseId: string;
  requestedBy?: { fullName?: string } | null;
  requestedById: string;
  status: string;
};

export type ApprovalReceiptRow = {
  id: string;
  number: string;
  sourceFileName?: string | null;
  status: string;
  items: unknown[];
};

type IssueProps = {
  rows: ApprovalIssueRow[];
  issueStatusLabel: (s: string) => string;
  statusTone: (s: string) => "ok" | "warn" | "bad" | "neutral";
  onOpenTable: (row: ApprovalIssueRow) => void;
  onOpenDetails: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  domainLabel: string;
};

export function ApprovalsIssueQueueTable({
  rows,
  issueStatusLabel,
  statusTone,
  onOpenTable,
  onOpenDetails,
  onApprove,
  onReject,
  domainLabel
}: IssueProps) {
  return (
    <section className="homePanel" style={{ marginTop: 12 }}>
      <div className="homePanelHead">
        <h3>Очередь на выдачу</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {domainLabel}
        </span>
      </div>
      <div className="erpTableWrap">
        <table className="erpTable desktopTable">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Склад</th>
              <th>Инициатор</th>
              <th>Статус</th>
              <th style={{ width: 280 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  В очереди ничего нет для этого типа.
                </td>
              </tr>
            ) : (
              rows.map((i) => (
                <tr key={i.id}>
                  <td>
                    <button type="button" className="ghostBtn" style={{ padding: 0, height: "auto" }} onClick={() => onOpenTable(i)}>
                      <strong>{i.number}</strong>
                    </button>
                  </td>
                  <td>{i.warehouse?.name || i.warehouseId}</td>
                  <td>{i.requestedBy?.fullName || i.requestedById}</td>
                  <td>
                    <StatusBadge tone={statusTone(i.status)}>{issueStatusLabel(i.status)}</StatusBadge>
                  </td>
                  <td>
                    <div className="erpCellActions">
                      <button type="button" className="ghostBtn" onClick={() => onOpenTable(i)}>
                        Таблица
                      </button>
                      <button type="button" className="ghostBtn" onClick={() => onOpenDetails(i.id)}>
                        Детали
                      </button>
                      <button type="button" className="primaryBtn" onClick={() => onApprove(i.id)}>
                        Одобрить
                      </button>
                      <button type="button" className="ghostBtn" onClick={() => onReject(i.id)}>
                        Отклонить
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ReceiptProps = {
  rows: ApprovalReceiptRow[];
  onOpenTable: (row: ApprovalReceiptRow) => void;
  onOpenReceipt: (id: string) => void;
};

export function ApprovalsReceiptRequestsTable({ rows, onOpenTable, onOpenReceipt }: ReceiptProps) {
  return (
    <section className="homePanel" style={{ marginTop: 12 }}>
      <div className="homePanelHead">
        <h3>Приходные заявки</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {rows.length} шт.
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">Приходных заявок пока нет.</p>
      ) : (
        <div className="erpTableWrap">
          <table className="erpTable desktopTable">
            <thead>
              <tr>
                <th>Номер</th>
                <th>Файл</th>
                <th>Статус</th>
                <th style={{ width: 72 }}>Поз.</th>
                <th style={{ width: 200 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button type="button" className="ghostBtn" style={{ padding: 0, height: "auto" }} onClick={() => onOpenTable(row)}>
                      <strong>{row.number}</strong>
                    </button>
                  </td>
                  <td className="muted">{row.sourceFileName || "—"}</td>
                  <td>
                    <StatusBadge tone={receiptStatusTone(row.status)}>{receiptStatusLabel(row.status)}</StatusBadge>
                  </td>
                  <td>{row.items.length}</td>
                  <td>
                    <div className="erpCellActions">
                      <button type="button" className="ghostBtn" onClick={() => onOpenTable(row)}>
                        Таблица
                      </button>
                      <button type="button" className="ghostBtn" onClick={() => onOpenReceipt(row.id)}>
                        Приёмка →
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
