'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import styles from './PositionPicker.module.css';

export type PositionValue = { id: string; kind: 'ROLE' | 'GROUP'; name: string; selectable?: boolean; reviewed?: boolean; family?: string };
export type PositionResults = { items: PositionValue[]; totalPages: number; searchState: 'READY' | 'DEGRADED' };
export type PositionRequest = (q: string, page: number, signal: AbortSignal) => Promise<PositionResults>;
export type PositionLabels = {
  placeholder: string; loading: string; empty: string; failed: string; retry: string;
  limited: string; group: string; role: string; unavailable: string; needsReview: string; remove: string; more: string;
};

type Props = {
  label: string;
  labels: PositionLabels;
  request: PositionRequest;
  value: PositionValue[];
  onChange: (value: PositionValue[]) => void;
  max?: number;
  disabled?: boolean;
};

const key = (value: PositionValue) => value.kind + ':' + value.id;

export function PositionPicker({ label, labels, request, value, onChange, max = 1, disabled }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(-1);
  const [response, setResponse] = useState<{ query: string; page: number; data: PositionResults }>();
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const term = query.trim();
  const current = response?.query === term ? response : undefined;
  const selected = new Set(value.map(key));
  const options = current?.data.items ?? [];
  const loading = pending || !current && !failed;
  const unavailable = (row: PositionValue) => row.selectable === false
    || (max > 1 && value.length >= max && !selected.has(key(row)));

  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    setPending(true);
    setFailed(false);
    const timer = setTimeout(() => {
      requestRef.current(term, page, controller.signal).then(data => {
        if (controller.signal.aborted) return;
        setResponse(previous => {
          if (page === 1 || previous?.query !== term) return { query: term, page, data };
          const items = [...new Map([...previous.data.items, ...data.items].map(row => [key(row), row])).values()];
          return { query: term, page, data: { ...data, items } };
        });
      }).catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      }).finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    }, page === 1 ? 160 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term, page, retry, open, disabled]);

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const place = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const below = bottom - rect.bottom - 8;
      const above = rect.top - top - 8;
      const flip = below < 160 && above > below;
      const height = Math.min(320, Math.max(48, flip ? above : below));
      setPosition({ left: rect.left, width: rect.width, maxHeight: height,
        ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, disabled]);

  useEffect(() => {
    if (active >= 0) document.getElementById(id + '-option-' + active)?.scrollIntoView({ block: 'nearest' });
  }, [id, active]);

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function choose(row: PositionValue) {
    if (disabled || row.selectable === false) return;
    if (selected.has(key(row))) onChange(value.filter(item => key(item) !== key(row)));
    else if (max === 1) onChange([row]);
    else if (value.length < max) onChange([...value, row]);
    else return;
    setQuery('');
    setPage(1);
    close();
  }

  function more() {
    if (!loading && !failed && current && current.page < current.data.totalPages) setPage(current.page + 1);
  }

  const portalTarget = open && typeof document !== 'undefined'
    ? input.current?.closest('dialog, [role="dialog"]') ?? document.body : null;
  return <div className={styles.root}>
    <label htmlFor={id}>{label}</label>
    {!!value.length && <div className={styles.selected}>{value.map(row => <span key={key(row)} className={styles.chip}>
      {row.name}{row.kind === 'GROUP' && <small>{labels.group}</small>}
      <button type="button" disabled={disabled} aria-label={labels.remove + ' ' + row.name}
        onClick={() => onChange(value.filter(item => key(item) !== key(row)))}>×</button>
    </span>)}</div>}
    <input id={id} ref={input} type="text" role="combobox" autoComplete="off" maxLength={160}
      aria-autocomplete="list" aria-expanded={open && !disabled} aria-controls={id + '-list'}
      aria-activedescendant={open && options[active] ? id + '-option-' + active : undefined}
      value={query} placeholder={labels.placeholder} disabled={disabled}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onBlur={event => { if (!panel.current?.contains(event.relatedTarget)) close(); }}
      onChange={event => {
        setQuery(event.target.value);
        setPage(1);
        setActive(-1);
        setFailed(false);
        setOpen(true);
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (event.key === 'Enter' && open) {
          event.preventDefault();
          if (options[active]) choose(options[active]);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          let next = active + direction;
          while (next >= 0 && next < options.length && unavailable(options[next])) next += direction;
          if (next >= 0 && next < options.length) setActive(next);
          else if (direction > 0) more();
        }
      }} />
    {portalTarget && position && !disabled && createPortal(<div className={styles.panel} style={position} ref={panel}
      onScroll={event => {
        const element = event.currentTarget;
        if (element.scrollHeight - element.scrollTop - element.clientHeight < 24) more();
      }}>
      <ul className={styles.list} id={id + '-list'} role="listbox" aria-label={label} aria-multiselectable={max > 1 || undefined}>
        {options.map((row, i) => <li key={key(row)} role="presentation">
          <button type="button" role="option" tabIndex={-1} id={id + '-option-' + i}
            aria-selected={selected.has(key(row))} aria-disabled={unavailable(row)}
            data-highlighted={i === active} onPointerDown={event => event.preventDefault()} onClick={() => choose(row)}>
            <span>{row.name}</span>
            <small>{row.selectable === false ? labels.unavailable : row.reviewed === false ? labels.needsReview
              : row.kind === 'GROUP' ? labels.group : labels.role}{row.family ? ' · ' + row.family : ''}</small>
          </button>
        </li>)}
      </ul>
      {current?.data.searchState === 'DEGRADED' && <p role="status">{labels.limited}</p>}
      {failed ? <div role="alert"><p>{labels.failed}</p><button type="button" tabIndex={-1}
        onPointerDown={event => event.preventDefault()} onClick={() => setRetry(n => n + 1)}>{labels.retry}</button></div>
        : loading ? <p role="status">{labels.loading}</p>
        : !options.length && current?.data.searchState === 'READY' ? <p role="status">{labels.empty}</p>
        : current && current.page < current.data.totalPages && <button type="button" tabIndex={-1}
          onPointerDown={event => event.preventDefault()} onClick={more}>{labels.more}</button>}
    </div>, portalTarget)}
  </div>;
}
