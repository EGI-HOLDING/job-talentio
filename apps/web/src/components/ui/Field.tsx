'use client';

import {
  Children,
  ReactElement,
  ReactNode,
  cloneElement,
  isValidElement,
  useId,
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
