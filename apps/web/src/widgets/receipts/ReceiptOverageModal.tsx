import { useState } from "react";

type LimitPick = {
  id: string;
  path: string;
  section?: string;
  templateTitle?: string;
};

type Props = {
  sourceName: string;
  orderedQty: number;
  acceptedQty: number;
  suggestions: { current: LimitPick[]; otherSections: LimitPick[] };
  initialLimitNodeId?: string;
  onCancel: () => void;
  onConfirm: (limitNodeId: string | null, allowOverage: boolean) => void;
};

export function ReceiptOverageModal({
  sourceName,
  orderedQty,
  acceptedQty,
  suggestions,
  initialLimitNodeId,
  onCancel,
  onConfirm
}: Props) {
  const all = [...suggestions.otherSections, ...suggestions.current];
  const needPick = suggestions.otherSections.length > 0;
  const [limitNodeId, setLimitNodeId] = useState(
    initialLimitNodeId || suggestions.otherSections[0]?.id || suggestions.current[0]?.id || ""
  );

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modalCard" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: "#b91c1c" }}>Приход больше заявки</h3>
        <p>
          По «<strong>{sourceName}</strong>» в заявке <strong>{orderedQty}</strong>, принимаете{" "}
          <strong>{acceptedQty}</strong> — будет критическое уведомление.
        </p>
        {needPick ? (
          <>
            <p className="muted">Тот же материал найден в других разделах лимита — выберите, куда отнести излишек:</p>
            <label style={{ display: "block", marginBottom: 12 }}>
              Раздел лимита
              <select value={limitNodeId} onChange={(e) => setLimitNodeId(e.target.value)} style={{ width: "100%" }}>
                <option value="">— не выбрано —</option>
                {suggestions.otherSections.length > 0 ? (
                  <optgroup label="Другие разделы / объекты лимита">
                    {suggestions.otherSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.path}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {suggestions.current.length > 0 ? (
                  <optgroup label="Текущий шаблон">
                    {suggestions.current.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.path}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
          </>
        ) : all.length === 0 ? (
          <p className="muted">В других разделах лимита материал не найден — излишек будет добавлен в текущий раздел автоматически.</p>
        ) : (
          <p className="muted">Излишек будет отнесён в текущий раздел лимита.</p>
        )}
        <div className="toolbar" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ghostBtn" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            disabled={needPick && !limitNodeId}
            onClick={() => onConfirm(needPick ? limitNodeId : limitNodeId || null, true)}
          >
            Принять с превышением
          </button>
        </div>
      </div>
    </div>
  );
}
