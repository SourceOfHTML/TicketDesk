'use client';

import type { UserSummary } from '@ticketdesk/shared';
import { useState, type FormEvent } from 'react';
import { ErrorBanner } from '../../components/error-banner';
import { FormField } from '../../components/form-field';
import { transport } from '../../lib/api';
import { emptyFormErrors, normalizeError, type FormErrors } from '../../lib/form-errors';
import { useMutation } from '../../lib/use-mutation';

/** The only fields a message may be attached to on this form. */
const SIGNUP_FIELDS = ['email', 'password'] as const;

export default function SignupPage() {
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<FormErrors>(emptyFormErrors);

  const mutation = useMutation(
    () =>
      transport<UserSummary>('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      }),
    // Signup starts the session, so there is nothing left to sign in to.
    { onSuccess: () => window.location.assign('/tickets') },
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (mutation.pending) {
      return;
    }

    // Cleared only on a submit that actually runs; a rejected signup renders
    // here and keeps the typed input.
    setErrors(emptyFormErrors());
    const result = await mutation.run();

    if (result !== undefined && !result.ok) {
      setErrors(normalizeError(result.error, SIGNUP_FIELDS));
    }
  }

  return (
    <section className="auth-card">
      <h1>Create account</h1>

      <ErrorBanner
        messages={errors.banner}
        details={errors.statusCode >= 500 ? errors.details : undefined}
      />

      {/* The whole form freezes: unlike login, a second submission here would
          create a second account. */}
      <form onSubmit={onSubmit} noValidate aria-busy={mutation.pending ? true : undefined}>
        <FormField
          id="email"
          label="Email"
          value={values.email}
          onChange={(email) => setValues((current) => ({ ...current, email }))}
          errors={errors.fields.email}
          disabled={mutation.pending}
          autoComplete="email"
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          value={values.password}
          onChange={(password) => setValues((current) => ({ ...current, password }))}
          errors={errors.fields.password}
          disabled={mutation.pending}
          autoComplete="new-password"
        />
        <button type="submit" className="button button-primary" disabled={mutation.pending}>
          Create account
        </button>
      </form>
    </section>
  );
}
