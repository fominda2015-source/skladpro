import { useEffect, useState, type ReactNode } from "react";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { ToolKitCompletenessFields } from "./ToolKitCompletenessFields";
import {
  buildToolDisplayName,
  formatKitCompleteness,
  formatEditableToolCategoryOptions,
  isKitTrackableToolCategory,
  isKitTrackableToolCategoryId,
  isManualToolCategory
} from "./toolDefaults";
import { toolStatusTone } from "./ToolsListTable";

export type ToolDrawerRecord = {
  id: string;
  name: string;
  inventoryNumber: string;
  serialNumber?: string | null;
  qrCode: string;
  status: string;
  section?: "SS" | "EOM";
  brand?: string | null;
  toolType?: string | null;
  categoryId?: string | null;
  category?: { id: string; name: string; slug?: string | null } | null;
  warehouseId?: string | null;
  warehouse?: { name: string } | null;
  responsible?: string | null;
  note?: string | null;
  kitComplete?: boolean;
  kitMissingNote?: string | null;
};

export type ToolCategoryOption = {
  id: string;
  name: string;
  icon?: string | null;
  slug?: string | null;
  order?: number;
  parentId?: string | null;
};
export type ToolWarehouseOption = { id: string; name: string };

export type ToolEditPatch = {
  name: string;
  brand: string;
  toolType: string;
  categoryId: string;
  serialNumber: string;
  warehouseId: string;
  section: "SS" | "EOM";
  responsible: string;
  note: string;
  kitComplete: boolean;
  kitMissingNote: string;
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
  categories: ToolCategoryOption[];
  warehouses: ToolWarehouseOption[];
  statusLabel: (s: string) => string;
  actionLabel: (a: string) => string;
  safeName: (n: string) => string;
  canWrite: boolean;
  saving?: boolean;
  savingKit?: boolean;
  onClose: () => void;
  onSave: (patch: ToolEditPatch) => boolean | void | Promise<boolean | void>;
  onSaveKit: (kitComplete: boolean, kitMissingNote: string) => boolean | void | Promise<boolean | void>;
  onIssue: () => void;
  onReturn: () => void;
  onRepair: () => void;
  onDispute: () => void;
  onWriteOff: () => void;
  onShowQr: () => void;
  onRefreshEvents: () => void;
  qrPreview?: ReactNode;
};

function buildDraft(tool: ToolDrawerRecord): ToolEditPatch {
  return {
    name: tool.name || "",
    brand: tool.brand || "",
    toolType: tool.toolType || "",
    categoryId: tool.categoryId || tool.category?.id || "",
    serialNumber: tool.serialNumber || "",
    warehouseId: tool.warehouseId || "",
    section: tool.section === "EOM" ? "EOM" : "SS",
    responsible: tool.responsible || "",
    note: tool.note || "",
    kitComplete: tool.kitComplete !== false,
    kitMissingNote: tool.kitMissingNote || ""
  };
}

function buildKitDraft(tool: ToolDrawerRecord) {
  return {
    kitComplete: tool.kitComplete !== false,
    kitMissingNote: tool.kitMissingNote || ""
  };
}

export function ToolDetailDrawer({
  tool,
  loading,
  events,
  eventsLoading,
  categories,
  warehouses,
  statusLabel,
  actionLabel,
  safeName,
  canWrite,
  saving,
  savingKit,
  onClose,
  onSave,
  onSaveKit,
  onIssue,
  onReturn,
  onRepair,
  onDispute,
  onWriteOff,
  onShowQr,
  onRefreshEvents,
  qrPreview
}: Props) {
  const [editing, setEditing] = useState(false);
  const [kitEditing, setKitEditing] = useState(false);
  const [draft, setDraft] = useState<ToolEditPatch | null>(null);
  const [kitDraft, setKitDraft] = useState({ kitComplete: true, kitMissingNote: "" });

  useEffect(() => {
    setEditing(false);
    setKitEditing(false);
    setDraft(tool ? buildDraft(tool) : null);
    setKitDraft(tool ? buildKitDraft(tool) : { kitComplete: true, kitMissingNote: "" });
  }, [tool?.id]);

  useEffect(() => {
    if (tool && !editing && !kitEditing) {
      setDraft(buildDraft(tool));
      setKitDraft(buildKitDraft(tool));
    }
  }, [tool, editing, kitEditing]);

  if (!tool && !loading) return null;

  const categoryOptions = formatEditableToolCategoryOptions(categories, draft?.categoryId || tool?.categoryId);
  const draftKitTrackable = draft ? isKitTrackableToolCategoryId(draft.categoryId, categories) : false;
  const toolKitTrackable = isKitTrackableToolCategory(tool?.category);
  const kitValid = !draftKitTrackable || draft?.kitComplete !== false || Boolean(draft?.kitMissingNote.trim());
  const kitDraftValid =
    kitDraft.kitComplete !== false || Boolean(kitDraft.kitMissingNote.trim());
  const canSave =
    Boolean(draft?.categoryId && draft.name.trim() && draft.brand.trim() && draft.toolType.trim()) &&
    kitValid &&
    !saving;

  return (
    <aside className="detailDrawer detailDrawerTool detailDrawerSticky">
      <div className="detailDrawerHeader">
        <h3>{tool ? safeName(tool.name) : "Инструмент"}</h3>
        <button type="button" className="ghostBtn" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {loading || !tool || !draft ? (
        <p className="muted">Загрузка карточки…</p>
      ) : editing ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Инв. <strong>{tool.inventoryNumber}</strong> · QR {tool.qrCode}
          </p>
          <div className="form" style={{ gap: 10 }}>
            <label>
              Категория
              <select
                value={draft.categoryId}
                onChange={(e) => {
                  const categoryId = e.target.value;
                  const kitTrackable = isKitTrackableToolCategoryId(categoryId, categories);
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          categoryId,
                          ...(kitTrackable ? {} : { kitComplete: true, kitMissingNote: "" })
                        }
                      : prev
                  );
                }}
              >
                {!draft.categoryId ? (
                  <option value="">— выберите категорию —</option>
                ) : null}
                {categoryOptions.map((c) => (
                  <option key={`ted-${c.id}`} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Марка
              <input
                value={draft.brand}
                onChange={(e) => {
                  const brand = e.target.value;
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          brand,
                          name: buildToolDisplayName(brand, prev.toolType)
                        }
                      : prev
                  );
                }}
              />
            </label>
            <label>
              Вид инструмента
              <input
                value={draft.toolType}
                onChange={(e) => {
                  const toolType = e.target.value;
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          toolType,
                          name: buildToolDisplayName(prev.brand, toolType)
                        }
                      : prev
                  );
                }}
              />
            </label>
            <label>
              Наименование
              <input
                value={draft.name}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
              />
            </label>
            <label>
              Серийный номер
              <input
                value={draft.serialNumber}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, serialNumber: e.target.value } : prev))}
              />
            </label>
            <label>
              Объект (склад)
              <select
                value={draft.warehouseId}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, warehouseId: e.target.value } : prev))}
              >
                <option value="">Не указан</option>
                {warehouses.map((w) => (
                  <option key={`tew-${w.id}`} value={w.id}>
                    {safeName(w.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Раздел
              <select
                value={draft.section}
                onChange={(e) =>
                  setDraft((prev) => (prev ? { ...prev, section: e.target.value as "SS" | "EOM" } : prev))
                }
              >
                <option value="SS">СС</option>
                <option value="EOM">ЭОМ</option>
              </select>
            </label>
            <label>
              Ответственный
              <input
                value={draft.responsible}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, responsible: e.target.value } : prev))}
              />
            </label>
            <label>
              Примечание
              <input
                value={draft.note}
                onChange={(e) => setDraft((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
              />
            </label>
            {draftKitTrackable ? (
              <ToolKitCompletenessFields
                kitComplete={draft.kitComplete}
                kitMissingNote={draft.kitMissingNote}
                onKitCompleteChange={(kitComplete) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          kitComplete,
                          kitMissingNote: kitComplete ? "" : prev.kitMissingNote
                        }
                      : prev
                  )
                }
                onKitMissingNoteChange={(kitMissingNote) =>
                  setDraft((prev) => (prev ? { ...prev, kitMissingNote } : prev))
                }
                disabled={saving}
              />
            ) : null}
          </div>
          <div className="erpCellActions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="primaryBtn"
              disabled={!canSave}
              onClick={() => {
                void (async () => {
                  const ok = await onSave(draft);
                  if (ok !== false) setEditing(false);
                })();
              }}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
            <button
              type="button"
              className="ghostBtn"
              disabled={saving}
              onClick={() => {
                setDraft(buildDraft(tool));
                setEditing(false);
              }}
            >
              Отмена
            </button>
          </div>
        </>
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
            {tool.section ? ` · ${tool.section}` : ""}
            {tool.responsible ? ` · ${tool.responsible}` : ""}
          </p>
          {tool.brand || tool.toolType ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {tool.brand ? `Марка: ${tool.brand}` : ""}
              {tool.brand && tool.toolType ? " · " : ""}
              {tool.toolType ? `Вид: ${tool.toolType}` : ""}
            </p>
          ) : null}
          {tool.note ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Примечание: {tool.note}
            </p>
          ) : null}
          {toolKitTrackable ? (
            <p
              className={`toolKitStatusLine${tool.kitComplete === false ? " toolKitStatusLine--warn" : ""}`}
              style={{ fontSize: 13 }}
            >
              {formatKitCompleteness(tool)}
            </p>
          ) : null}
          {kitEditing && toolKitTrackable ? (
            <div style={{ marginTop: 10 }}>
              <ToolKitCompletenessFields
                kitComplete={kitDraft.kitComplete}
                kitMissingNote={kitDraft.kitMissingNote}
                onKitCompleteChange={(kitComplete) =>
                  setKitDraft((prev) => ({
                    kitComplete,
                    kitMissingNote: kitComplete ? "" : prev.kitMissingNote
                  }))
                }
                onKitMissingNoteChange={(kitMissingNote) =>
                  setKitDraft((prev) => ({ ...prev, kitMissingNote }))
                }
                disabled={savingKit}
              />
              <div className="erpCellActions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="primaryBtn"
                  disabled={!kitDraftValid || savingKit}
                  onClick={() => {
                    void (async () => {
                      const ok = await onSaveKit(
                        kitDraft.kitComplete,
                        kitDraft.kitComplete ? "" : kitDraft.kitMissingNote
                      );
                      if (ok !== false) setKitEditing(false);
                    })();
                  }}
                >
                  {savingKit ? "Сохранение…" : "Сохранить комплектность"}
                </button>
                <button
                  type="button"
                  className="ghostBtn"
                  disabled={savingKit}
                  onClick={() => {
                    setKitDraft(buildKitDraft(tool));
                    setKitEditing(false);
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
          <div className="erpCellActions" style={{ marginTop: 10 }}>
            {canWrite ? (
              <button type="button" className="ghostBtn" onClick={() => setEditing(true)}>
                Редактировать
              </button>
            ) : null}
            {canWrite && toolKitTrackable && !kitEditing ? (
              <button type="button" className="ghostBtn" onClick={() => setKitEditing(true)}>
                Изменить комплектность
              </button>
            ) : null}
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
                  <th>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {eventsLoading ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      Загрузка…
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      Записей нет
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontSize: 12 }}>{new Date(e.createdAt).toLocaleString()}</td>
                      <td>{actionLabel(e.action)}</td>
                      <td>{statusLabel(e.status)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {e.comment || "—"}
                      </td>
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
