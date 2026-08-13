'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

type ConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  requireTypedValue?: string;
  typedLabel?: string;
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
  requireTypedValue,
  typedLabel,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useI18n();
  const confirmText = confirmLabel ?? t('ui.confirm');
  const cancelText = cancelLabel ?? t('cancel');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    setTyped('');
  }, [requireTypedValue]);

  const typedOk =
    !requireTypedValue ||
    typed.trim().toLowerCase() === requireTypedValue.trim().toLowerCase();

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
        {requireTypedValue ? (
          <label className="form-stack" style={{ display: 'block', marginBottom: '1rem' }}>
            <span className="muted" style={{ display: 'block', marginBottom: '0.35rem' }}>
              {typedLabel || t('ui.typeToConfirm')}
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
        ) : null}
        <div className="confirm-modal-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button
            type="button"
            className={danger ? 'danger' : 'cta'}
            onClick={onConfirm}
            disabled={busy || !typedOk}
          >
            {busy ? t('ui.working') : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
