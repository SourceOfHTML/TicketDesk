'use client';

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
}: FormFieldProps) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete={autoComplete}
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
    <div>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={id}
        value={value}
        rows={6}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        {...fieldAria(id, errors)}
      />
      <FieldErrors id={id} errors={errors} />
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  errors?: string[];
  disabled?: boolean;
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  errors = [],
  disabled = false,
}: SelectFieldProps<T>) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
        {...fieldAria(id, errors)}
      >
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
    <ul id={`${id}-errors`}>
      {errors.map((message, index) => (
        <li key={`${id}-${index}`}>{message}</li>
      ))}
    </ul>
  );
}
