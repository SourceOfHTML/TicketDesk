'use client';

import type { ReactNode } from 'react';

interface FormFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Never `email`: the app imposes no native constraint, only the API's rules. */
  type?: 'text' | 'password';
  errors?: string[];
  disabled?: boolean;
  autoComplete?: string;
  /** For a field that is required, without the banned native `required`. */
  ariaRequired?: boolean;
}

export function FormField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  errors = [],
  disabled = false,
  autoComplete,
  ariaRequired = false,
}: FormFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete={autoComplete}
        aria-required={ariaRequired ? true : undefined}
        {...fieldAria(id, errors)}
      />
      <FieldErrors id={id} errors={errors} />
    </div>
  );
}

interface TextAreaFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
  disabled?: boolean;
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  errors = [],
  disabled = false,
}: TextAreaFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={id}
        value={value}
        rows={7}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        {...fieldAria(id, errors)}
      />
      <FieldErrors id={id} errors={errors} />
    </div>
  );
}

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  /** An empty leading choice, so a select can start with nothing chosen. */
  placeholder?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  errors?: string[];
  disabled?: boolean;
}

export function SelectField({
  id,
  label,
  value,
  placeholder,
  options,
  onChange,
  errors = [],
  disabled = false,
}: SelectFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        {...fieldAria(id, errors)}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldErrors id={id} errors={errors} />
    </div>
  );
}

interface RadioGroupFieldProps<T extends string> {
  id: string;
  label: string;
  value: T;
  /** A node, so a caller can render each option as the same badge a page shows. */
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  errors?: string[];
  disabled?: boolean;
}

export function RadioGroupField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  errors = [],
  disabled = false,
}: RadioGroupFieldProps<T>) {
  return (
    <fieldset className="radio-group" {...fieldAria(id, errors)}>
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="radio-option">
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
          />
          <span className="option-label">{option.label}</span>
        </label>
      ))}
      <FieldErrors id={id} errors={errors} />
    </fieldset>
  );
}

/** The aria contract every control shares: invalid state and its messages. */
function fieldAria(
  id: string,
  errors: string[],
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return errors.length === 0 ? {} : { 'aria-invalid': true, 'aria-describedby': `${id}-errors` };
}

/** One field's messages, wired by the field's own `aria-describedby`. */
function FieldErrors({ id, errors }: { id: string; errors: string[] }) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <ul id={`${id}-errors`} className="field-errors">
      {errors.map((message, index) => (
        <li key={`${id}-${index}`}>{message}</li>
      ))}
    </ul>
  );
}
