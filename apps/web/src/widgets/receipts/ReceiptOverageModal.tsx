import { useState } from "react";

type LimitPick = {
  id: string;
  path: string;
  section?: string;
  templateTitle?: string;
};

export type ReceiptOverageKind = "receipt_order" | "limit_plan";

type Props = {
  kind: ReceiptOverageKind;
  sourceName: string;
  acceptedQty: number;
  orderedQty?: number;
  plannedQty?: number;
  receivedOnNode?: number;
  primaryPath?: string;
  excessQty?: number;
  suggestions: { current: LimitPick[]; otherSections: LimitPick[] };
  initialLimitNodeId?: string;
  onCancel: () => void;
  onConfirm: (
    spreadLimitNodeId: string | null,
    flags: { allowOverage?: boolean; allowLimitOverage?: boolean }
  ) => void;
};

export function ReceiptOverageModal({
  kind,
  sourceName,
  orderedQty,
  acceptedQty,
  plannedQty,
  receivedOnNode,
  primaryPath,
  excessQty,
  suggestions,
  initialLimitNodeId,
  onCancel,
  onConfirm
}: Props) {
  const spreadOptions = suggestions.otherSections;
  const needPick = spreadOptions.length > 0;
  const [spreadLimitNodeId, setSpreadLimitNodeId] = useState(
    initialLimitNodeId && spreadOptions.some((s) => s.id === initialLimitNodeId)
      ? initialLimitNodeId
      : spreadOptions[0]?.id || ""
  );

  const isLimit = kind === "limit_plan";

  return (
    <div
      className="modalOverlay receiptOverageOverlay"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div className="modalCard" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: "#b91c1c" }}>
          {isLimit ? "Превышение лимита в подразделе" : "Приход больше заявки"}
        </h3>
        {isLimit ? (
          <p>
            «<strong>{sourceName}</strong>»
            {primaryPath ? (
              <>
                {" "}
                · подраздел <strong>{primaryPath}</strong>
              </>
            ) : null}
            <br />
            План лимита: <strong>{plannedQty ?? "—"}</strong>, уже принято по подразделу:{" "}
            <strong>{receivedOnNode ?? 0}</strong>, сейчас принимаете <strong>{acceptedQty}</strong>
            {excessQty != null && excessQty > 0 ? (
              <>
                {" "}
                — излишек <strong>{excessQty}</strong>
              </>
            ) : null}
            .
          </p>
        ) : (
          <p>
            По «<strong>{sourceName}</strong>» в заявке <strong>{orderedQty}</strong>, принимаете{" "}
            <strong>{acceptedQty}</strong> — будет критическое уведомление.
          </p>
        )}

        {needPick ? (
          <>
            <p className="muted">
              {isLimit
                ? "Тот же материал есть в других подразделах лимита — выберите, куда отнести излишек:"
                : "Тот же материал найден в других разделах лимита — выберите, куда отнести излишек:"}
            </p>
            {suggestions.current.length > 0 ? (
              <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Основная привязка: {suggestions.current[0]?.path}
              </p>
            ) : null}
            <label style={{ display: "block", marginBottom: 12 }}>
              Подраздел для излишка
              <select
                value={spreadLimitNodeId}
                onChange={(e) => setSpreadLimitNodeId(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">— выберите —</option>
                {spreadOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.path}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : isLimit ? (
          <p className="muted">
            В других разделах лимита этот материал не найден — размазать излишек некуда. Подтвердите
            перерасход в текущем подразделе.
          </p>
        ) : (
          <p className="muted">
            В других разделах лимита материал не найден — излишек будет отнесён в текущий подраздел.
          </p>
        )}

        <div className="toolbar" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ghostBtn" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            disabled={needPick && !spreadLimitNodeId}
            onClick={() =>
              onConfirm(needPick ? spreadLimitNodeId : null, {
                allowOverage: !isLimit,
                allowLimitOverage: isLimit
              })
            }
          >
            {isLimit ? "Подтвердить перерасход" : "Принять с превышением"}
          </button>
        </div>
      </div>
    </div>
  );
}
