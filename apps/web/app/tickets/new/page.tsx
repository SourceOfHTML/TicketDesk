'use client';

import type { CreateTicketInput, Priority, Ticket } from '@ticketdesk/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ErrorBanner } from '../../../components/error-banner';
import { FormField, RadioGroupField, TextAreaField } from '../../../components/form-field';
import { PriorityBadge } from '../../../components/ticket-badges';
import { sessionRequest } from '../../../lib/api';
import { emptyFormErrors, normalizeError, type FormErrors } from '../../../lib/form-errors';
import { PRIORITY_OPTIONS } from '../../../lib/ticket-labels';
import { useMutation } from '../../../lib/use-mutation';

/** The only fields a message may be attached to on this form. */
const TICKET_FIELDS = ['title', 'description', 'priority'] as const;

/**
 * The form may hold a Priority not yet chosen; the wire input may not. Starting
 * unset keeps the choice explicit — a Requester who forgets it gets the API's
 * 400 beside the group rather than a silently chosen Priority.
 */
type FormValues = Omit<CreateTicketInput, 'priority'> & { priority: Priority | '' };

/** Each Priority is drawn exactly as it will appear on the Ticket it produces. */
const PRIORITY_CHOICES = PRIORITY_OPTIONS.map((option) => ({
  value: option.value,
  label: <PriorityBadge priority={option.value} />,
}));

export default function NewTicketPage() {
  const [values, setValues] = useState<FormValues>({
    title: '',
    description: '',
    priority: '',
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
      <form
        className="ticket-form"
        onSubmit={onSubmit}
        noValidate
        aria-busy={mutation.pending ? true : undefined}
      >
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
        <RadioGroupField
          id="priority"
          label="Priority"
          value={values.priority}
          options={PRIORITY_CHOICES}
          onChange={(priority) => setValues((current) => ({ ...current, priority }))}
          errors={errors.fields.priority}
          disabled={mutation.pending}
        />
        <button type="submit" className="button button-primary" disabled={mutation.pending}>
          Raise ticket
        </button>
      </form>

      <p>
        <Link className="back-link" href="/tickets">
          Back to tickets
        </Link>
      </p>
    </section>
  );
}
