'use client';

import type { UserSummary } from '@ticketdesk/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorBanner } from '../../components/error-banner';
import { FormField } from '../../components/form-field';
import { transport } from '../../lib/api';
import { emptyFormErrors, normalizeError, type FormErrors } from '../../lib/form-errors';

/** The only fields a message may be attached to on this form. */
const LOGIN_FIELDS = ['email', 'password'] as const;

export default function LoginPage() {
  // Read the query in an effect rather than with useSearchParams: the form is
  // static chrome and stays in the prerendered HTML; the URL itself is never
  // rewritten, so ?expired=1 stays in the address bar.
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => {
    setSessionEnded(new URLSearchParams(window.location.search).get('expired') === '1');
  }, []);

  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<FormErrors>(emptyFormErrors);
  const [pending, setPending] = useState(false);

  // Set synchronously, so Enter-key and programmatic submissions are caught too.
  const pendingRef = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (pendingRef.current) {
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setErrors(emptyFormErrors());

    const result = await transport<UserSummary>('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (result.ok) {
      window.location.assign('/tickets');
      return;
    }

    // A rejected sign-in renders here; it never redirects. Typed input survives.
    pendingRef.current = false;
    setPending(false);
    setErrors(normalizeError(result.error, LOGIN_FIELDS));
  }

  return (
    <section>
      <h1>Sign in</h1>

      {sessionEnded ? <p role="status">Your session ended. Sign in again.</p> : null}

      <ErrorBanner
        messages={errors.banner}
        details={errors.statusCode >= 500 ? errors.details : undefined}
      />

      <form onSubmit={onSubmit} noValidate aria-busy={pending ? true : undefined}>
        <FormField
          id="email"
          label="Email"
          value={values.email}
          onChange={(email) => setValues((current) => ({ ...current, email }))}
          errors={errors.fields.email}
          disabled={pending}
          autoComplete="username"
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          value={values.password}
          onChange={(password) => setValues((current) => ({ ...current, password }))}
          errors={errors.fields.password}
          disabled={pending}
          autoComplete="current-password"
        />
        <button type="submit" disabled={pending}>
          Sign in
        </button>
      </form>
    </section>
  );
}
