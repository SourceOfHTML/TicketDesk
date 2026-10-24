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
  const errorsId = `${id}-errors`;

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
        aria-invalid={errors.length > 0 ? true : undefined}
        aria-describedby={errors.length > 0 ? errorsId : undefined}
      />
      <FieldErrors id={errorsId} errors={errors} />
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
  rows?: number;
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  errors = [],
  disabled = false,
  rows = 6,
}: TextAreaFieldProps) {
  const errorsId = `${id}-errors`;

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={id}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={errors.length > 0 ? true : undefined}
        aria-describedby={errors.length > 0 ? errorsId : undefined}
      />
      <FieldErrors id={errorsId} errors={errors} />
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
  const errorsId = `${id}-errors`;

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
        aria-invalid={errors.length > 0 ? true : undefined}
        aria-describedby={errors.length > 0 ? errorsId : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldErrors id={errorsId} errors={errors} />
    </div>
  );
}

/** One field's messages, wired by the field's own `aria-describedby`. */
function FieldErrors({ id, errors }: { id: string; errors: string[] }) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <ul id={id}>
      {errors.map((message, index) => (
        <li key={`${id}-${index}`}>{message}</li>
      ))}
    </ul>
  );
}
