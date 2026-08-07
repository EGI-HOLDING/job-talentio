'use client';

import { useEffect, useState } from 'react';
import { formatThousands, parseThousands } from '@/lib/numberFormat';

type Props = {
  name?: string;
  id?: string;
  value?: number | null;
  defaultValue?: number | string | null;
  onValueChange?: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  min?: number;
  className?: string;
  'aria-label'?: string;
};

/**
 * Integer money/amount input with live "." thousand separators.
 * Hidden sibling (when `name` set) submits raw digits for FormData.
 */
export function NumberInput({
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  required,
  min,
  className,
  'aria-label': ariaLabel,
}: Props) {
  const controlled = value !== undefined;
  const initial =
    value ??
    (defaultValue === null || defaultValue === undefined || defaultValue === ''
      ? null
      : typeof defaultValue === 'number'
        ? defaultValue
        : parseThousands(String(defaultValue)));

  const [display, setDisplay] = useState(() =>
    initial == null ? '' : formatThousands(initial),
  );
  const [numeric, setNumeric] = useState<number | null>(initial);

  useEffect(() => {
    if (!controlled) return;
    setNumeric(value ?? null);
    setDisplay(value == null ? '' : formatThousands(value));
  }, [controlled, value]);

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setNumeric(null);
      setDisplay('');
      onValueChange?.(null);
      return;
    }
    let n = Number(digits);
    if (!Number.isFinite(n)) return;
    if (min != null && n < min) n = min;
    setNumeric(n);
    setDisplay(formatThousands(n));
    onValueChange?.(n);
  }

  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        className={className}
        aria-label={ariaLabel}
        value={display}
        onChange={(e) => handleChange(e.target.value)}
      />
      {name ? (
        <input type="hidden" name={name} value={numeric == null ? '' : String(numeric)} />
      ) : null}
    </>
  );
}
