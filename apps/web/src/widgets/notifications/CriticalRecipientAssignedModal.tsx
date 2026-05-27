type Props = {
  onClose: () => void;
};

/** Показывается пользователю после назначения получателем критических уведомлений. */
export function CriticalRecipientAssignedModal({ onClose }: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modalCard" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Критические уведомления</h3>
        <p style={{ marginBottom: 12 }}>
          Вас назначили получателем <strong>критических уведомлений</strong> по складу: приход сверх заявки,
          списание инструмента, перерасход по лимитам.
        </p>
        <p className="muted" style={{ marginTop: 0 }}>
          Дубликаты приходят в личный чат от бота <strong>«Помощник»</strong>.
        </p>
        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}
