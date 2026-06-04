type Props = {
  kitComplete: boolean;
  kitMissingNote: string;
  onKitCompleteChange: (complete: boolean) => void;
  onKitMissingNoteChange: (note: string) => void;
  disabled?: boolean;
};

export function ToolKitCompletenessFields({
  kitComplete,
  kitMissingNote,
  onKitCompleteChange,
  onKitMissingNoteChange,
  disabled
}: Props) {
  return (
    <fieldset className="toolKitFieldset" disabled={disabled}>
      <legend>Комплектность</legend>
      <div className="toolKitOptions" role="radiogroup" aria-label="Комплектность">
        <label className={`toolKitOption${kitComplete ? " toolKitOption--active" : ""}`}>
          <input
            type="radio"
            name="kitComplete"
            checked={kitComplete}
            onChange={() => onKitCompleteChange(true)}
          />
          <span className="toolKitOptionLabel">Комплект</span>
        </label>
        <label className={`toolKitOption${!kitComplete ? " toolKitOption--active" : ""}`}>
          <input
            type="radio"
            name="kitComplete"
            checked={!kitComplete}
            onChange={() => onKitCompleteChange(false)}
          />
          <span className="toolKitOptionLabel">Некомплект</span>
        </label>
      </div>
      {!kitComplete ? (
        <label className="toolKitMissingLabel">
          Чего не хватает
          <textarea
            className="toolKitMissingInput"
            rows={3}
            value={kitMissingNote}
            onChange={(e) => onKitMissingNoteChange(e.target.value)}
            placeholder="Например: зарядное устройство, кейс"
          />
        </label>
      ) : null}
    </fieldset>
  );
}
