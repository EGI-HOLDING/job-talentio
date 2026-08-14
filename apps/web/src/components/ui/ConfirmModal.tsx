'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';

export type ConfirmTone = 'default' | 'danger' | 'create';

export type ConfirmModalProps = {
  title: string;
  message?: string;
  highlight?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  danger?: boolean;
  busy?: boolean;
  requireTypedValue?: string;
  typedLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

function ToneIcon({ tone }: { tone: ConfirmTone }) {
  if (tone === 'create') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path
          d="M12 5v14M5 12h14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (tone === 'danger') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path
          d="M12 8v5.5M12 16.5h.01"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M12 4.2L3.6 19h16.8L12 4.2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 11.2v5M12 8.2h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ConfirmModal({
  title,
  message,
  highlight,
  confirmLabel,
  cancelLabel,
  tone,
  danger = false,
  busy = false,
  requireTypedValue,
  typedLabel,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descId = useId();
  const resolvedTone: ConfirmTone = tone ?? (danger ? 'danger' : 'default');
  const confirmText = confirmLabel ?? t('ui.confirm');
  const cancelText = cancelLabel ?? t('cancel');
  const [typed, setTyped] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  onCancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    setTyped('');
  }, [requireTypedValue, title]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTarget = resolvedTone === 'danger' ? cancelRef.current : confirmRef.current;
    focusTarget?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault();
        onCancelRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [resolvedTone, title]);

  const typedOk =
    !requireTypedValue ||
    typed.trim().toLowerCase() === requireTypedValue.trim().toLowerCase();

  return (
    <div
      className="modal-backdrop confirm-modal-backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="presentation"
    >
      <div
        className={`modal confirm-modal confirm-modal--${resolvedTone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-modal__head">
          <span className="confirm-modal__icon" aria-hidden>
            <ToneIcon tone={resolvedTone} />
          </span>
          <h2 id={titleId}>{title}</h2>
        </div>
        {highlight ? (
          <p className="confirm-modal__highlight">
            <span>{highlight}</span>
          </p>
        ) : null}
        {message ? (
          <p id={descId} className="confirm-modal__message">
            {message}
          </p>
        ) : null}
        {requireTypedValue ? (
          <label className="confirm-modal__typed">
            <span>{typedLabel || t('ui.typeToConfirm')}</span>
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
          <button
            ref={cancelRef}
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={resolvedTone === 'danger' ? 'danger' : 'cta'}
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
