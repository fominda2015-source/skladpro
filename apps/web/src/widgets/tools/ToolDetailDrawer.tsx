import type { ReactNode } from "react";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { isManualToolCategory } from "./toolDefaults";
import { toolStatusTone } from "./ToolsListTable";

export type ToolDrawerRecord = {
  id: string;
  name: string;
  inventoryNumber: string;
  serialNumber?: string | null;
  qrCode: string;
  status: string;
  calibrationDueAt?: string | null;
  brand?: string | null;
  toolType?: string | null;
  category?: { id: string; name: string } | null;
  warehouse?: { name: string } | null;
  responsible?: string | null;
};

export type ToolEventRow = {
  id: string;
  action: string;
  status: string;
  comment?: string | null;
  createdAt: string;
};

type Props = {
  tool: ToolDrawerRecord | null;
  loading?: boolean;
  events: ToolEventRow[];
  eventsLoading: boolean;
  statusLabel: (s: string) => string;
  actionLabel: (a: string) => string;
  safeName: (n: string) => string;
  calibrationDraft: string;
  onCalibrationDraftChange: (v: string) => void;
  canWrite: boolean;
  onClose: () => void;
  onSaveCalibration: () => void;
  onIssue: () => void;
  onReturn: () => void;
  onRepair: () => void;
  onDispute: () => void;
  onWriteOff: () => void;
  onShowQr: () => void;
  onRefreshEvents: () => void;
  qrPreview?: ReactNode;
};

export function ToolDetailDrawer({
  tool,
  loading,
  events,
  eventsLoading,
  statusLabel,
  actionLabel,
  safeName,
  calibrationDraft,
  onCalibrationDraftChange,
  canWrite,
  onClose,
  onSaveCalibration,
  onIssue,
  onReturn,
  onRepair,
  onDispute,
  onWriteOff,
  onShowQr,
  onRefreshEvents,
  qrPreview
}: Props) {
  if (!tool && !loading) return null;

  return (
    <aside className="detailDrawer detailDrawerTool detailDrawerSticky">
      <div className="detailDrawerHeader">
        <h3>{tool ? safeName(tool.name) : "Инструмент"}</h3>
        <button type="button" className="ghostBtn" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {loading || !tool ? (
        <p className="muted">Загрузка карточки…</p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Инв. <strong>{tool.inventoryNumber}</strong>
            {tool.serialNumber ? ` · с/н ${tool.serialNumber}` : ""}
          </p>
          <p className="muted">
            <StatusBadge tone={toolStatusTone(tool.status)}>{statusLabel(tool.status)}</StatusBadge>
            {tool.category?.name ? ` · ${tool.category.name}` : ""}
            {tool.warehouse?.name ? ` · ${safeName(tool.warehouse.name)}` : ""}
            {tool.responsible ? ` · ${tool.responsible}` : ""}
          </p>
          {tool.brand || tool.toolType ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {tool.brand ? `Марка: ${tool.brand}` : ""}
              {tool.brand && tool.toolType ? " · " : ""}
              {tool.toolType ? `Вид: ${tool.toolType}` : ""}
            </p>
          ) : null}
          {canWrite ? (
            <label className="muted" style={{ display: "block", fontSize: 13, marginTop: 8 }}>
              Поверка до
              <input
                type="date"
                value={calibrationDraft}
                onChange={(e) => onCalibrationDraftChange(e.target.value)}
                style={{ display: "block", marginTop: 4, width: "100%" }}
              />
              <button type="button" className="ghostBtn" style={{ marginTop: 6 }} onClick={onSaveCalibration}>
                Сохранить дату поверки
              </button>
            </label>
          ) : tool.calibrationDueAt ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Поверка до: {new Date(tool.calibrationDueAt).toLocaleDateString("ru-RU")}
            </p>
          ) : null}
          <div className="erpCellActions" style={{ marginTop: 10 }}>
            {tool.status !== "ISSUED" && canWrite ? (
              <button type="button" className="primaryBtn" onClick={onIssue}>
                Выдать
              </button>
            ) : null}
            {tool.status !== "IN_STOCK" && canWrite ? (
              <button type="button" className="ghostBtn" onClick={onReturn}>
                На склад
              </button>
            ) : null}
            {tool.status !== "IN_REPAIR" && canWrite ? (
              <button type="button" className="ghostBtn" onClick={onRepair}>
                В ремонт
              </button>
            ) : null}
            {canWrite ? (
              <button type="button" className="ghostBtn" onClick={onDispute}>
                Спор
              </button>
            ) : null}
            {canWrite && !isManualToolCategory(tool.category?.name) ? (
              <button type="button" className="ghostBtn" onClick={onWriteOff}>
                Списать
              </button>
            ) : null}
            {canWrite && isManualToolCategory(tool.category?.name) ? (
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.45 }}>
                Ручной инструмент списывается только по акту «Списание» на имя ответственного (раздел «Акты»).
              </p>
            ) : null}
            <button type="button" className="ghostBtn" onClick={onShowQr}>
              QR
            </button>
          </div>
          {qrPreview}
          <h4 style={{ margin: "14px 0 8px" }}>Журнал</h4>
          <button type="button" className="ghostBtn" onClick={onRefreshEvents}>
            ↻ Обновить
          </button>
          <div className="erpTableWrap" style={{ marginTop: 8 }}>
            <table className="erpTable desktopTable">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Действие</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {eventsLoading ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      Загрузка…
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      Записей нет
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontSize: 12 }}>{new Date(e.createdAt).toLocaleString()}</td>
                      <td>{actionLabel(e.action)}</td>
                      <td>{statusLabel(e.status)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </aside>
  );
}
