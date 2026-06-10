import { useEffect, useState } from "react";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { formatMaterialQty, parseMaterialQty, sanitizeMaterialQtyInput } from "../../shared/quantity";
import {
  consumableActionLabel,
  consumableCardStatusLabel,
  consumableConditionLabel,
  type ToolCatalogConsumableDetail
} from "./toolCatalog";

type EditDraft = { name: string; unit: string; note: string; quantity: string };

type Props = {
  detail: ToolCatalogConsumableDetail | null;
  loading?: boolean;
  canWrite: boolean;
  saving?: boolean;
  deleting?: boolean;
  onClose: () => void;
  onIssue: () => void;
  onSave: (patch: EditDraft) => Promise<boolean>;
  onWriteOff: () => void;
  onDispute: () => void;
  onClearDispute: () => void;
  onDelete: () => void;
  onRefreshEvents: () => void;
  safeName: (name: string) => string;
};

function consumableStatusTone(status: string | undefined): "ok" | "warn" | "bad" | "neutral" {
  if (status === "DISPUTED") return "warn";
  if (status === "WRITTEN_OFF") return "bad";
  if (status === "IN_STOCK") return "ok";
  return "neutral";
}

export function ToolConsumableDrawer({
  detail,
  loading,
  canWrite,
  saving,
  deleting,
  onClose,
  onIssue,
  onSave,
  onWriteOff,
  onDispute,
  onClearDispute,
  onDelete,
  onRefreshEvents,
  safeName
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>({ name: "", unit: "", note: "", quantity: "" });

  useEffect(() => {
    if (!detail) return;
    setEditing(false);
    setDraft({
      name: detail.name,
      unit: detail.unit,
      note: detail.note ?? "",
      quantity: String(parseMaterialQty(detail.quantity))
    });
  }, [detail?.stockId, detail?.name, detail?.unit, detail?.note, detail?.quantity]);

  if (!detail && !loading) return null;

  const cardStatus = detail?.cardStatus ?? (detail?.disputed ? "DISPUTED" : "IN_STOCK");

  return (
    <aside className="detailDrawer detailDrawerTool detailDrawerSticky">
      <div className="detailDrawerHeader">
        <h3>{detail ? safeName(detail.name) : "Расходник"}</h3>
        <button type="button" className="ghostBtn" onClick={onClose}>
          Закрыть
        </button>
      </div>

      {loading || !detail ? (
        <p className="muted">Загрузка карточки…</p>
      ) : editing ? (
        <>
          <div className="form" style={{ gap: 10 }}>
            <label>
              Наименование
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </label>
            <label>
              Ед. изм.
              <input value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} />
            </label>
            <label>
              Кол-во ({draft.unit || detail?.unit || "шт"})
              <input
                type="text"
                inputMode="numeric"
                value={draft.quantity}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: sanitizeMaterialQtyInput(e.target.value) }))}
              />
            </label>
            <label>
              Примечание
              <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
            </label>
          </div>
          <div className="erpCellActions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="primaryBtn"
              disabled={saving || !draft.name.trim() || !draft.unit.trim() || draft.quantity === ""}
              onClick={() => {
                void (async () => {
                  const qty = parseMaterialQty(draft.quantity);
                  if (draft.quantity === "" || qty < 0) return;
                  const ok = await onSave({ ...draft, quantity: String(qty) });
                  if (ok) setEditing(false);
                })();
              }}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
            <button type="button" className="ghostBtn" disabled={saving} onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Кол-во <strong className="toolConsumableDrawerQty">{formatMaterialQty(detail.quantity)}</strong>{" "}
            {detail.unit}
            {detail.condition === "USED" ? " · б/у" : " · новые"}
          </p>
          <p className="muted">
            <StatusBadge tone={consumableStatusTone(cardStatus)}>{consumableCardStatusLabel(cardStatus)}</StatusBadge>
            {" · "}
            <StatusBadge tone={detail.condition === "USED" ? "warn" : "doc"}>
              {consumableConditionLabel(detail.condition)}
            </StatusBadge>
            {` · ${detail.section} · ${safeName(detail.warehouseName)}`}
          </p>
          {detail.note ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Примечание: {detail.note}
            </p>
          ) : null}
          {detail.condition === "USED" ? (
            <p className="resultBanner warn" style={{ fontSize: 13 }}>
              Б/у позиция — рекомендуем выдавать в первую очередь.
            </p>
          ) : null}
          <div className="erpCellActions" style={{ marginTop: 10, flexDirection: "column", alignItems: "stretch" }}>
            {canWrite && detail.quantity > 0 && !detail.disputed ? (
              <button type="button" className="primaryBtn" onClick={onIssue}>
                Выдать
              </button>
            ) : null}
            {canWrite ? (
              <button type="button" className="ghostBtn" onClick={() => setEditing(true)}>
                Редактировать
              </button>
            ) : null}
            {canWrite && detail.quantity > 0 ? (
              <button type="button" className="ghostBtn" onClick={onWriteOff}>
                Списать
              </button>
            ) : null}
            {canWrite && !detail.disputed ? (
              <button type="button" className="ghostBtn" onClick={onDispute}>
                Спор
              </button>
            ) : null}
            {canWrite && detail.disputed ? (
              <button type="button" className="ghostBtn" onClick={onClearDispute}>
                Снять спор
              </button>
            ) : null}
            {canWrite && detail.quantity === 0 ? (
              <button
                type="button"
                className="ghostBtn"
                style={{ color: "var(--danger, #b91c1c)" }}
                disabled={deleting || saving}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Удалить карточку «${safeName(detail.name)}» (${consumableConditionLabel(detail.condition)})?`
                    )
                  ) {
                    return;
                  }
                  void onDelete();
                }}
              >
                {deleting ? "Удаление…" : "Удалить карточку"}
              </button>
            ) : null}
          </div>
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
                  <th>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {!detail.events.length ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      Записей нет
                    </td>
                  </tr>
                ) : (
                  detail.events.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">{new Date(e.createdAt).toLocaleString("ru-RU")}</td>
                      <td>{consumableActionLabel(e.action)}</td>
                      <td className="muted">{e.comment || "—"}</td>
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
