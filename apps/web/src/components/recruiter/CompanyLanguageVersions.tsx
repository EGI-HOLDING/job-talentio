'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { LOCALES, type Locale } from '@/lib/locale';
import { LabelText } from '@/components/ui/Field';

type CompanyTranslation = {
  locale: Locale;
  description: string;
  isMachine: boolean;
};

type CompanyTranslations = {
  sourceLocale: Locale;
  source: { description: string | null };
  translations: CompanyTranslation[];
};

const LOCALE_NAME_KEY: Record<Locale, string> = {
  uz: 'rec.localeNameUz',
  ru: 'rec.localeNameRu',
  en: 'rec.localeNameEn',
};

type Props = {
  companyId: string;
  onFlash: (message: string, tone?: 'success' | 'error') => void;
};

/**
 * Extra language versions of the company blurb. The legal name is never
 * translated, so only the description is editable here.
 */
export function CompanyLanguageVersions({ companyId, onFlash }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<CompanyTranslations | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<Locale, string>>>({});
  const [busyLocale, setBusyLocale] = useState<Locale | null>(null);
  const [autoLocale, setAutoLocale] = useState<Locale | null>(null);

  const flashRef = useRef(onFlash);
  useEffect(() => {
    flashRef.current = onFlash;
  }, [onFlash]);

  const load = useCallback(async () => {
    try {
      const res = await api<CompanyTranslations>(`/companies/${companyId}/translations`);
      setData(res);
      setLoadFailed(false);
      setDrafts((prev) => {
        const next: Partial<Record<Locale, string>> = {};
        for (const locale of LOCALES) {
          const saved = res.translations.find((tr) => tr.locale === locale);
          if (saved) next[locale] = saved.description;
          else if (prev[locale]) next[locale] = prev[locale];
        }
        return next;
      });
    } catch (err) {
      setLoadFailed(true);
      flashRef.current(
        err instanceof Error ? err.message : t('rec.langVersionsLoadFailed'),
        'error',
      );
    }
  }, [companyId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function autoTranslate(locale: Locale) {
    const langName = t(LOCALE_NAME_KEY[locale]);
    setAutoLocale(locale);
    try {
      await api(`/companies/${companyId}/translations/${locale}/auto`, { method: 'POST' });
      onFlash(t('rec.langVersionSaved').replace('{lang}', langName));
      await load();
    } catch (err) {
      onFlash(err instanceof Error ? err.message : t('ui.translateFailed'), 'error');
    } finally {
      setAutoLocale(null);
    }
  }

  async function saveVersion(locale: Locale) {
    const description = (drafts[locale] ?? '').trim();
    const langName = t(LOCALE_NAME_KEY[locale]);
    if (!description) {
      onFlash(t('rec.companyLangVersionFill').replace('{lang}', langName), 'error');
      return;
    }
    setBusyLocale(locale);
    try {
      await api(`/companies/${companyId}/translations/${locale}`, {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      });
      onFlash(t('rec.langVersionSaved').replace('{lang}', langName));
      await load();
    } catch (err) {
      onFlash(err instanceof Error ? err.message : t('rec.langVersionSaveFailed'), 'error');
    } finally {
      setBusyLocale(null);
    }
  }

  async function deleteVersion(locale: Locale) {
    const langName = t(LOCALE_NAME_KEY[locale]);
    if (!confirm(t('rec.langVersionConfirmDelete').replace('{lang}', langName))) return;
    setBusyLocale(locale);
    try {
      await api(`/companies/${companyId}/translations/${locale}`, { method: 'DELETE' });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[locale];
        return next;
      });
      onFlash(t('rec.langVersionDeleted').replace('{lang}', langName));
      await load();
    } catch (err) {
      onFlash(err instanceof Error ? err.message : t('rec.langVersionDeleteFailed'), 'error');
    } finally {
      setBusyLocale(null);
    }
  }

  return (
    <div className="card">
      <h3>{t('rec.companyLangVersionsTitle')}</h3>
      <p className="muted" style={{ margin: '0.35rem 0 0.65rem', fontSize: '0.85rem' }}>
        {t('rec.companyLangVersionsHint')}
      </p>
      {loadFailed ? (
        <p className="muted" style={{ margin: 0 }}>
          {t('rec.langVersionsLoadFailed')}
        </p>
      ) : !data ? (
        <p className="muted" style={{ margin: 0 }}>
          {t('rec.loading')}
        </p>
      ) : (
        <>
          <span className="badge">
            {t('rec.langVersionSource').replace('{lang}', t(LOCALE_NAME_KEY[data.sourceLocale]))}
          </span>
          {LOCALES.filter((locale) => locale !== data.sourceLocale).map((locale) => {
            const saved = data.translations.find((tr) => tr.locale === locale);
            const busy = busyLocale === locale || autoLocale === locale;
            const langName = t(LOCALE_NAME_KEY[locale]);
            return (
              <div
                key={locale}
                style={{
                  marginTop: '0.85rem',
                  paddingTop: '0.85rem',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div className="chips" style={{ alignItems: 'center' }}>
                  <strong>{langName}</strong>
                  <span className="badge">
                    {!saved
                      ? t('rec.langVersionMissing')
                      : saved.isMachine
                        ? t('rec.langVersionMachine')
                        : t('rec.langVersionHuman')}
                  </span>
                </div>
                {saved?.isMachine && (
                  <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
                    {t('rec.langVersionMachineNote')}
                  </p>
                )}
                <label style={{ display: 'block', marginTop: '0.6rem' }}>
                  <LabelText required>{t('rec.description')}</LabelText>
                  <textarea
                    rows={4}
                    maxLength={5000}
                    value={drafts[locale] ?? ''}
                    disabled={busy}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [locale]: e.target.value }))
                    }
                  />
                </label>
                <div className="chips" style={{ marginTop: '0.6rem' }}>
                  <button
                    type="button"
                    className="chip"
                    disabled={busy || !data.source.description?.trim()}
                    onClick={() => autoTranslate(locale)}
                  >
                    {autoLocale === locale ? t('ui.translating') : t('rec.langVersionAutoTranslate')}
                  </button>
                  <button
                    type="button"
                    className="chip active"
                    disabled={busy}
                    onClick={() => saveVersion(locale)}
                  >
                    {busyLocale === locale ? t('saving') : t('rec.langVersionSave')}
                  </button>
                  {saved && (
                    <button
                      type="button"
                      className="chip"
                      disabled={busy}
                      onClick={() => deleteVersion(locale)}
                    >
                      {t('rec.langVersionDelete')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
