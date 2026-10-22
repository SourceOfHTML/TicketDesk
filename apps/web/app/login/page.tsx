'use client';

import type { UserSummary } from '@ticketdesk/shared';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorBanner } from '../../components/error-banner';
import { FormField } from '../../components/form-field';
import { transport } from '../../lib/api';
import { emptyFormErrors, normalizeError, type FormErrors } from '../../lib/form-errors';
import { useMutation } from '../../lib/use-mutation';

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

  const mutation = useMutation(
    () =>
      transport<UserSummary>('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      }),
    { onSuccess: () => window.location.assign('/tickets') },
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (mutation.pending) {
      return;
    }

    // Cleared only on a submit that actually runs; a rejected sign-in renders
    // here and never redirects, and the typed input survives.
    setErrors(emptyFormErrors());
    const result = await mutation.run();

    if (result !== undefined && !result.ok) {
      setErrors(normalizeError(result.error, LOGIN_FIELDS));
    }
  }

  return (
    <section>
      <h1>Sign in</h1>

      {sessionEnded ? <p role="status">Your session ended. Sign in again.</p> : null}

      <ErrorBanner
        messages={errors.banner}
        details={errors.statusCode >= 500 ? errors.details : undefined}
      />

      <form onSubmit={onSubmit} noValidate>
        <FormField
          id="email"
          label="Email"
          value={values.email}
          onChange={(email) => setValues((current) => ({ ...current, email }))}
          errors={errors.fields.email}
          autoComplete="username"
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          value={values.password}
          onChange={(password) => setValues((current) => ({ ...current, password }))}
          errors={errors.fields.password}
          autoComplete="current-password"
        />
        {/* Only the initiating control freezes; the fields stay usable. */}
        <button
          type="submit"
          disabled={mutation.pending}
          aria-busy={mutation.pending ? true : undefined}
        >
          Sign in
        </button>
      </form>

      <p>
        <Link href="/signup">Create an account</Link>
      </p>
    </section>
  );
}
