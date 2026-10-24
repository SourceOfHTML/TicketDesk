'use client';

import type { Priority, Ticket } from '@ticketdesk/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ErrorBanner } from '../../../components/error-banner';
import { FormField, SelectField, TextAreaField } from '../../../components/form-field';
import { sessionRequest } from '../../../lib/api';
import { emptyFormErrors, normalizeError, type FormErrors } from '../../../lib/form-errors';
import { optionsOf, PRIORITY_LABELS } from '../../../lib/ticket-labels';
import { useMutation } from '../../../lib/use-mutation';

/** The only fields a message may be attached to on this form. */
const TICKET_FIELDS = ['title', 'description', 'priority'] as const;

const PRIORITY_OPTIONS = optionsOf(PRIORITY_LABELS);

interface FormValues {
  title: string;
  description: string;
  priority: Priority;
}

export default function NewTicketPage() {
  const [values, setValues] = useState<FormValues>({
    title: '',
    description: '',
    priority: 'medium',
  });
  const [errors, setErrors] = useState<FormErrors>(emptyFormErrors);

  const mutation = useMutation(
    () =>
      sessionRequest<Ticket>('/api/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      }),
    // A hard navigation: the new Ticket's page must be a fresh load, not a
    // client transition carrying the previous page's state.
    { onSuccess: (ticket) => window.location.assign(`/tickets/${ticket.id}`) },
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (mutation.pending) {
      return;
    }

    // Cleared only on a submit that actually runs. A rejected raise renders
    // here and never navigates, so everything typed survives.
    setErrors(emptyFormErrors());
    const result = await mutation.run();

    if (result !== undefined && !result.ok) {
      setErrors(normalizeError(result.error, TICKET_FIELDS));
    }
  }

  return (
    <section>
      <h1>Raise a ticket</h1>

      <ErrorBanner
        messages={errors.banner}
        details={errors.statusCode >= 500 ? errors.details : undefined}
      />

      {/* The whole form freezes: a second submission would create a second
          Ticket. */}
      <form onSubmit={onSubmit} noValidate aria-busy={mutation.pending ? true : undefined}>
        <FormField
          id="title"
          label="Title"
          value={values.title}
          onChange={(title) => setValues((current) => ({ ...current, title }))}
          errors={errors.fields.title}
          disabled={mutation.pending}
        />
        <TextAreaField
          id="description"
          label="Description"
          value={values.description}
          onChange={(description) => setValues((current) => ({ ...current, description }))}
          errors={errors.fields.description}
          disabled={mutation.pending}
        />
        <SelectField
          id="priority"
          label="Priority"
          value={values.priority}
          options={PRIORITY_OPTIONS}
          onChange={(priority) => setValues((current) => ({ ...current, priority }))}
          errors={errors.fields.priority}
          disabled={mutation.pending}
        />
        <button type="submit" disabled={mutation.pending}>
          Raise ticket
        </button>
      </form>

      <p>
        <Link href="/tickets">Back to tickets</Link>
      </p>
    </section>
  );
}
