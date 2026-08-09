'use client';

import {
  Children,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  cloneElement,
  isValidElement,
  useId,
  useState,
} from 'react';
import { useI18n } from '@/lib/i18n';

type LabelTextProps = {
  children: ReactNode;
  /** Field must be filled */
  required?: boolean;
  /** Show “(optional)” when not required. Default: true when required is false. */
  optional?: boolean;
};

/** Visual + screen-reader required/optional marker for use inside a wrapping `<label>`. */
export function LabelText({ children, required = false, optional }: LabelTextProps) {
  const { t } = useI18n();
  const showOptional = optional ?? !required;

  return (
    <span className="label-text">
      <span className="label-text-main">{children}</span>
      {required ? (
        <>
          <abbr className="field-req" title={t('required')}>
            *
          </abbr>
          <span className="sr-only"> ({t('required')})</span>
        </>
      ) : showOptional ? (
        <span className="field-opt">({t('optional')})</span>
      ) : null}
    </span>
  );
}

type FormFieldProps = {
  label: ReactNode;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement;
  className?: string;
};

/** Label + control with stable id, aria-required / aria-invalid / describedby. */
export function FormField({
  label,
  required = false,
  optional,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  const autoId = useId();
  const child = Children.only(children);
  if (!isValidElement(child)) {
    throw new Error('FormField expects a single React element child');
  }

  const id = (child.props as { id?: string }).id ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = cloneElement(child as ReactElement<Record<string, unknown>>, {
    id,
    required: required || (child.props as { required?: boolean }).required,
    'aria-required': required || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  });

  return (
    <label htmlFor={id} className={className}>
      <LabelText required={required} optional={optional}>
        {label}
      </LabelText>
      {control}
      {hint ? (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

type FormAlertProps = {
  children: ReactNode;
  tone?: 'error' | 'success';
};

export function FormAlert({ children, tone = 'error' }: FormAlertProps) {
  if (!children) return null;
  return (
    <div className={tone} role="alert" aria-live="polite">
      {children}
    </div>
  );
}

type FilterFieldsetProps = {
  legend: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Group of related filters/checkboxes with an accessible legend. */
export function FilterFieldset({ legend, children, className }: FilterFieldsetProps) {
  return (
    <fieldset className={className ? `filter-fieldset ${className}` : 'filter-fieldset'}>
      <legend className="filter-legend">{legend}</legend>
      {children}
    </fieldset>
  );
}

function EyeIcon({ crossed }: { crossed?: boolean }) {
  return (
    <svg
      className="pw-eye-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {crossed ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** When used outside FormField / without i18n context for labels */
  showLabel?: string;
  hideLabel?: string;
};

/**
 * Password input with show/hide toggle (eye icon).
 * Compatible with FormField: id / aria-* are applied to the inner input.
 */
export function PasswordInput({
  id,
  className,
  showLabel,
  hideLabel,
  disabled,
  ...props
}: PasswordInputProps) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const show = showLabel ?? t('showPassword');
  const hide = hideLabel ?? t('hidePassword');

  return (
    <div className={className ? `pw-field ${className}` : 'pw-field'}>
      <input
        {...props}
        id={id}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        spellCheck={false}
      />
      <button
        type="button"
        className="pw-toggle"
        tabIndex={0}
        disabled={disabled}
        aria-pressed={visible}
        aria-label={visible ? hide : show}
        title={visible ? hide : show}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
      >
        <EyeIcon crossed={visible} />
        <span className="sr-only">{visible ? hide : show}</span>
      </button>
    </div>
  );
}
