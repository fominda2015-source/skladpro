import { Fragment } from "react";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { formatMaterialQty, parseMaterialQty } from "../../shared/quantity";
import { receiptStatusLabel, receiptStatusTone } from "../receipts/receiptLabels";
import { MobileCard, MobileCardActions, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

export type ApprovalIssueRow = {
  id: string;
  number: string;
  warehouse?: { name?: string } | null;
  warehouseId: string;
  requestedBy?: { fullName?: string } | null;
  requestedById: string;
  status: string;
};

export type ApprovalReceiptItemRow = {
  id: string;
  sourceName: string;
  sourceUnit?: string | null;
  quantity: number | string;
  acceptedQty?: number | string | null;
};

export type ApprovalReceiptRow = {
  id: string;
  number: string;
  sourceFileName?: string | null;
  status: string;
  fromLimit?: boolean;
  limitTemplate?: { id: string; title: string } | null;
  externalOrderNumber?: string | null;
  items: ApprovalReceiptItemRow[];
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
      <ResponsiveTableShell>
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
                      <button
                        type="button"
                        className="ghostBtn"
                        style={{ padding: 0, height: "auto" }}
                        onClick={() => onOpenTable(i)}
                      >
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
        <div className="mobileCards">
          {rows.length === 0 ? (
            <p className="muted">В очереди ничего нет для этого типа.</p>
          ) : (
            rows.map((i) => (
              <MobileCard key={`m-${i.id}`}>
                <h4>{i.number}</h4>
                <MobileCardField label="Склад">{i.warehouse?.name || i.warehouseId}</MobileCardField>
                <MobileCardField label="Инициатор">{i.requestedBy?.fullName || i.requestedById}</MobileCardField>
                <MobileCardField label="Статус">
                  <StatusBadge tone={statusTone(i.status)}>{issueStatusLabel(i.status)}</StatusBadge>
                </MobileCardField>
                <MobileCardActions>
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
                </MobileCardActions>
              </MobileCard>
            ))
          )}
        </div>
      </ResponsiveTableShell>
    </section>
  );
}

type ReceiptProps = {
  rows: ApprovalReceiptRow[];
  expandedIds: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  safeName: (s: string) => string;
  onOpenTable: (row: ApprovalReceiptRow) => void;
  onOpenReceipt: (id: string) => void;
  onAddInvoice?: (row: ApprovalReceiptRow) => void;
  canWrite?: boolean;
  emptyHint?: string;
};

export function ApprovalsReceiptRequestsTable({
  rows,
  expandedIds,
  onToggleExpand,
  safeName,
  onOpenTable,
  onOpenReceipt,
  onAddInvoice,
  canWrite = true,
  emptyHint = "Приходных заявок пока нет."
}: ReceiptProps) {
  return (
    <section className="homePanel" style={{ marginTop: 12 }}>
      <div className="homePanelHead">
        <h3>Приходные заявки</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {rows.length} шт. · нажмите ▶, чтобы раскрыть позиции
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">{emptyHint}</p>
      ) : (
        <ResponsiveTableShell>
          <div className="erpTableWrap">
            <table className="erpTable desktopTable">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Номер</th>
                  <th>Файл / лимит</th>
                  <th>Статус</th>
                  <th style={{ width: 72 }}>Поз.</th>
                  <th style={{ width: 320 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isExpanded = expandedIds[row.id] === true;
                  return (
                    <Fragment key={row.id}>
                      <tr className={isExpanded ? "rowHighlight" : undefined}>
                        <td>
                          <button
                            type="button"
                            className="erpRowToggle"
                            aria-label={isExpanded ? "Свернуть" : "Развернуть"}
                            onClick={() => onToggleExpand(row.id)}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ghostBtn"
                            style={{ padding: 0, height: "auto" }}
                            onClick={() => onOpenTable(row)}
                          >
                            <strong>{row.number}</strong>
                          </button>
                          {row.externalOrderNumber && row.externalOrderNumber !== row.number ? (
                            <div className="muted" style={{ fontSize: 11 }}>
                              № в файле: {row.externalOrderNumber}
                            </div>
                          ) : null}
                        </td>
                        <td className="muted">
                          {row.sourceFileName || "—"}
                          {row.fromLimit ? (
                            <div style={{ fontSize: 11 }}>
                              Из лимита
                              {row.limitTemplate ? ` · ${safeName(row.limitTemplate.title)}` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <StatusBadge tone={receiptStatusTone(row.status)}>
                            {receiptStatusLabel(row.status)}
                          </StatusBadge>
                        </td>
                        <td>{row.items.length}</td>
                        <td>
                          <div className="erpCellActions">
                            <button type="button" className="ghostBtn" onClick={() => onOpenTable(row)}>
                              Таблица
                            </button>
                            {canWrite && onAddInvoice ? (
                              <button
                                type="button"
                                className="ghostBtn"
                                onClick={() => onAddInvoice(row)}
                                title="Открыть заявку и приложить счёт"
                              >
                                Счёт →
                              </button>
                            ) : null}
                            <button type="button" className="ghostBtn" onClick={() => onOpenReceipt(row.id)}>
                              Приёмка →
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="erpTableExpand">
                          <td colSpan={6}>
                            <div className="erpTableExpandInner">
                              <table className="erpTable desktopTable" style={{ marginTop: 4 }}>
                                <thead>
                                  <tr>
                                    <th>Позиция</th>
                                    <th>Заказано</th>
                                    <th>Принято</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.items.map((it) => (
                                    <tr key={it.id}>
                                      <td>{safeName(it.sourceName)}</td>
                                      <td>
                                        {formatMaterialQty(parseMaterialQty(it.quantity))} {it.sourceUnit || "шт"}
                                      </td>
                                      <td>{formatMaterialQty(parseMaterialQty(it.acceptedQty))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mobileCards">
            {rows.map((row) => {
              const isExpanded = expandedIds[row.id] === true;
              return (
                <MobileCard key={`m-${row.id}`}>
                  <div className="toolbar" style={{ justifyContent: "space-between", padding: 0, marginBottom: 6 }}>
                    <h4 style={{ margin: 0 }}>{row.number}</h4>
                    <button type="button" className="ghostBtn" onClick={() => onToggleExpand(row.id)}>
                      {isExpanded ? "Свернуть" : "Позиции"}
                    </button>
                  </div>
                  <MobileCardField label="Файл">{row.sourceFileName || "—"}</MobileCardField>
                  {row.fromLimit ? (
                    <MobileCardField label="Лимит">
                      {row.limitTemplate ? safeName(row.limitTemplate.title) : "да"}
                    </MobileCardField>
                  ) : null}
                  <MobileCardField label="Статус">
                    <StatusBadge tone={receiptStatusTone(row.status)}>{receiptStatusLabel(row.status)}</StatusBadge>
                  </MobileCardField>
                  {isExpanded ? (
                    <ul className="plainList" style={{ margin: "8px 0", fontSize: 13 }}>
                      {row.items.map((it) => (
                        <li key={it.id}>
                          {safeName(it.sourceName)} — {formatMaterialQty(parseMaterialQty(it.quantity))}{" "}
                          {it.sourceUnit || "шт"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <MobileCardField label="Позиций">{row.items.length}</MobileCardField>
                  )}
                  <MobileCardActions>
                    <button type="button" className="ghostBtn" onClick={() => onOpenTable(row)}>
                      Таблица
                    </button>
                    {canWrite && onAddInvoice ? (
                      <button type="button" className="ghostBtn" onClick={() => onAddInvoice(row)}>
                        Счёт →
                      </button>
                    ) : null}
                    <button type="button" className="ghostBtn" onClick={() => onOpenReceipt(row.id)}>
                      Приёмка →
                    </button>
                  </MobileCardActions>
                </MobileCard>
              );
            })}
          </div>
        </ResponsiveTableShell>
      )}
    </section>
  );
}
