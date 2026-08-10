'use client';

import { useI18n } from '@/lib/i18n';

type ConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useI18n();
  const confirmText = confirmLabel ?? t('ui.confirm');
  const cancelText = cancelLabel ?? t('cancel');

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="presentation"
    >
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title">{title}</h2>
        <p id="confirm-modal-desc" className="muted" style={{ marginTop: 0 }}>
          {message}
        </p>
        <div className="confirm-modal-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button
            type="button"
            className={danger ? 'danger' : 'cta'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('ui.working') : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
