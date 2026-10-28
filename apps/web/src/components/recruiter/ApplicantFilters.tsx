'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n, useEnumLabel } from '@/lib/i18n';
import s from './RecruiterWorkspace.module.css';
export function ApplicantFilters({
  meta,
  onApply,
  embedded = false,
}: {
  meta: any;
  onApply: (filters: Record<string, string>) => void;
  embedded?: boolean;
}) {
  const { t } = useI18n(),
    label = useEnumLabel();
  const [countries, setCountries] = useState<any[]>([]),
    [cities, setCities] = useState<any[]>([]),
    [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    api<any[]>('/meta/countries')
      .then((data) => {
        if (alive) setCountries(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setCities([]);
    if (values.country)
      api<any[]>('/meta/cities?country=' + values.country)
        .then((data) => {
          if (alive) setCities(data);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [values.country]);
  const change = (key: string, value: string) =>
    setValues((current) => ({
      ...current,
      [key]: value,
      ...(key === 'country' ? { city: '' } : {}),
    }));
  const multi = (key: string, items: any[], keyName: string, title: string) => (
    <label>
      {title}
      <select
        multiple
        size={4}
        value={(values[key] || '').split(',').filter(Boolean)}
        onChange={(event) =>
          change(
            key,
            Array.from(event.target.selectedOptions)
              .map((item) => item.value)
              .join(','),
          )
        }
      >
        {items.map((item) => (
          <option key={item[keyName]} value={item[keyName]}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
  const form = (
      <form
        className={s.fields}
        style={{ paddingBlock: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          onApply(values);
        }}
      >
        <div className={s.fieldRow}>
          <label>
            {t('hr.country')}
            <select
              value={values.country || ''}
              onChange={(event) => change('country', event.target.value)}
            >
              <option value="">{t('hr.all')}</option>
              {countries.map((country) => (
                <option key={country.id} value={country.slug}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('city')}
            <select
              disabled={!values.country}
              value={values.city || ''}
              onChange={(event) => change('city', event.target.value)}
            >
              <option value="">{t('hr.all')}</option>
              {cities.map((city) => (
                <option key={city.id} value={city.slug}>
                  {city.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('education')}
            <select
              value={values.degree || ''}
              onChange={(event) => change('degree', event.target.value)}
            >
              <option value="">{t('hr.all')}</option>
              {['HIGH_SCHOOL', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'PHD'].map((degree) => (
                <option key={degree} value={degree}>
                  {label('degree', degree)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={s.fieldRow}>
          {multi('skills', meta.skills || [], 'slug', t('skills'))}
          {multi('languages', meta.languages || [], 'code', t('languages'))}
          <label>
            {t('hr.skillMode')}
            <select
              value={values.skillMode || 'OR'}
              onChange={(event) => change('skillMode', event.target.value)}
            >
              <option value="OR">{t('any')}</option>
              <option value="AND">{t('hr.all')}</option>
            </select>
          </label>
        </div>
        <div className={s.fieldRow}>
          {['experienceYearsMin', 'experienceYearsMax'].map((key, index) => (
            <label key={key}>
              {t(index ? 'hr.experienceMax' : 'hr.experienceMin')}
              <input
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={values[key] || ''}
                onChange={(event) => change(key, event.target.value)}
              />
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={values.hasCertification === 'true'}
              onChange={(event) => change('hasCertification', String(event.target.checked))}
            />
            {t('hr.certificate')}
          </label>
        </div>
        <div className={s.actions}>
          <button
            className={s.secondary}
            type="button"
            onClick={() => {
              setValues({});
              onApply({});
            }}
          >
            {t('clearFilters')}
          </button>
          <button className={s.primary} type="submit">
            {t('hr.applyFilters')}
          </button>
        </div>
      </form>
  );
  return embedded ? form : <details style={{padding:'12px 24px'}}><summary>{t('hr.filters')}</summary>{form}</details>;
}
