'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { JobsIcon } from './JobsIcon';
import s from './WorkspaceSelect.module.css';

type Option = { value: string; label: string };
type Props = { value: string; options: Option[]; label: string; onChange: (value: string) => void; className?: string };

export function WorkspaceSelect({ value, options, label, onChange, className = '' }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const flip = below < 220 && above > below;
      const width = Math.min(Math.max(180, rect.width), window.innerWidth - 32);
      setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), width, maxHeight: Math.min(320, Math.max(120, (flip ? above : below) - 20)), ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);

  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, id, open]);

  function show() {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }
  function choose(option: Option) { onChange(option.value); setOpen(false); trigger.current?.focus(); }

  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} className={`${s.trigger} ${className}`} onClick={() => open ? setOpen(false) : show()} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) show();
        else setActive((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!open) show(); else if (options[active]) choose(options[active]);
      } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      else if (event.key === 'Tab') setOpen(false);
      else if (open && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1); }
    }}><span>{selected?.label || value}</span><JobsIcon kind="chevron" /></button>
    {open && position && createPortal(<div ref={panel} id={id} role="listbox" aria-label={label} className={s.panel} style={position}>{options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value} className={`${s.option} ${active === index ? s.active : ''}`} onPointerMove={(event) => { if (event.pointerType === 'mouse') setActive(index); }} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}><span>{option.label}</span>{value === option.value && <JobsIcon kind="check" />}</div>)}</div>, document.body)}
  </>;
}
