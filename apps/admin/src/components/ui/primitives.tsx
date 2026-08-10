'use client';

import { ReactNode } from 'react';

type Tone = 'default' | 'ok' | 'warn' | 'danger' | 'accent';

export function Badge({ tone = 'default', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={tone === 'default' ? 'badge' : `badge ${tone}`}>{children}</span>;
}

export function Card({
  title,
  action,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  foot,
  attention = false,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  attention?: boolean;
}) {
  return (
    <div className={attention ? 'stat attention' : 'stat'}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </div>
  );
}

export function Alert({ tone, children }: { tone: 'error' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <p className={`alert ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint ? <div>{hint}</div> : null}
    </div>
  );
}

export function SearchIcon() {
  return (
    <span className="search-icon" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Multi-value filters are stored as comma separated strings in the URL. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  format = (v: string) => v,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  format?: (value: string) => string;
}) {
  const selected = value ? value.split(',').filter(Boolean) : [];

  function toggle(option: string) {
    const next = selected.includes(option)
      ? selected.filter((s) => s !== option)
      : [...selected, option];
    onChange(next.join(','));
  }

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.25rem' }}>
      <legend
        style={{
          fontSize: '0.78rem',
          color: 'var(--muted)',
          fontWeight: 500,
          padding: 0,
          marginBottom: '0.1rem',
        }}
      >
        {label}
      </legend>
      <div className="chips">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              className={active ? 'btn sm' : 'btn sm secondary'}
              aria-pressed={active}
              onClick={() => toggle(option)}
            >
              {format(option)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  allLabel = 'Any',
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label>
      {label}
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <table>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((__, c) => (
                <td key={c}>
                  <div className="skel" style={{ width: c === 0 ? '60%' : '80%' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
