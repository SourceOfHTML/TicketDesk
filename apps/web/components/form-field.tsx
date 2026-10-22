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
  const hasErrors = errors.length > 0;
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
        aria-invalid={hasErrors ? true : undefined}
        aria-describedby={hasErrors ? errorsId : undefined}
      />
      {hasErrors ? (
        <ul id={errorsId}>
          {errors.map((message, index) => (
            <li key={`${id}-${index}`}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
