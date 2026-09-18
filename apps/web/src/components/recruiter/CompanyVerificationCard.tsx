'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { FormAlert, LabelText } from '@/components/ui/Field';

type VerificationState = {
  isVerified: boolean;
  request: {
    id: string;
    legalName: string;
    taxId: string;
    note?: string | null;
    documentName?: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    reviewNote?: string | null;
    reviewedAt?: string | null;
    createdAt: string;
  } | null;
};

type Props = {
  companyId: string;
  canSubmit: boolean;
  onFlash: (message: string, tone?: 'success' | 'error') => void;
  /** Called after a submission so the parent can refresh the trust banner. */
  onChanged?: () => void;
};

/** Verified-employer badge: current state plus the request form when nothing is pending. */
export function CompanyVerificationCard({ companyId, canSubmit, onFlash, onChanged }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<VerificationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);

  async function load() {
    try {
      const next = await api<VerificationState>(`/companies/${companyId}/verification`);
      setState(next);
    } catch {
      setState(null);
    }
  }

  useEffect(() => {
    if (!companyId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const body = new FormData();
    body.set('legalName', String(fd.get('legalName') || '').trim());
    body.set('taxId', String(fd.get('taxId') || '').trim());
    const note = String(fd.get('note') || '').trim();
    if (note) body.set('note', note);
    if (file) body.set('document', file);
    try {
      await api(`/companies/${companyId}/verification`, { method: 'POST', body });
      onFlash(t('rec.verification.submitted'));
      setFile(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rec.verification.submitFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const request = state.request;
  const pending = request?.status === 'PENDING';
  const rejected = request?.status === 'REJECTED';

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {t('rec.verification.title')}
        {state.isVerified ? (
          <span className="badge" style={{ fontSize: '0.7rem' }}>{t('rec.verification.badgeVerified')}</span>
        ) : pending ? (
          <span className="badge" style={{ fontSize: '0.7rem' }}>{t('rec.verification.badgePending')}</span>
        ) : null}
      </h3>

      {state.isVerified ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>{t('rec.verification.verifiedBody')}</p>
      ) : pending && request ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          {t('rec.verification.pendingBody')
            .replace('{legalName}', request.legalName)
            .replace('{date}', new Date(request.createdAt).toLocaleDateString())}
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>{t('rec.verification.intro')}</p>
          {rejected && request ? (
            <div className="error" style={{ marginBottom: '0.75rem' }}>
              {t('rec.verification.rejectedNotice')}
              {request.reviewNote ? ` ${request.reviewNote}` : ''}
            </div>
          ) : null}
          {canSubmit ? (
            <form className="form-stack" onSubmit={submit}>
              <label>
                <LabelText required>{t('rec.verification.legalName')}</LabelText>
                <input
                  name="legalName"
                  required
                  minLength={2}
                  maxLength={200}
                  defaultValue={request?.legalName || ''}
                  placeholder={t('rec.verification.legalNamePlaceholder')}
                />
              </label>
              <label>
                <LabelText required>{t('rec.verification.taxId')}</LabelText>
                <input
                  name="taxId"
                  required
                  inputMode="numeric"
                  pattern="[0-9A-Za-z-]{6,20}"
                  defaultValue={request?.taxId || ''}
                  placeholder="123456789"
                />
                <span className="muted" style={{ display: 'block', fontSize: '0.78rem', marginTop: '0.25rem' }}>
                  {t('rec.verification.taxIdHint')}
                </span>
              </label>
              <label>
                <LabelText optional>{t('rec.verification.document')}</LabelText>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <span className="muted" style={{ display: 'block', fontSize: '0.78rem', marginTop: '0.25rem' }}>
                  {t('rec.verification.documentHint')}
                </span>
              </label>
              <label>
                <LabelText optional>{t('rec.verification.note')}</LabelText>
                <textarea name="note" rows={2} maxLength={1000} />
              </label>
              <FormAlert>{error}</FormAlert>
              <button type="submit" disabled={busy}>
                {busy ? t('rec.verification.submitting') : t('rec.verification.submit')}
              </button>
            </form>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{t('rec.verification.ownerOnly')}</p>
          )}
        </>
      )}
    </div>
  );
}
