'use client';

import type { Priority, Status, Ticket } from '@ticketdesk/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorBanner } from '../../components/error-banner';
import { sessionRequest } from '../../lib/api';
import { normalizeError, type FormErrors } from '../../lib/form-errors';

const STATUS_OPTIONS: ReadonlyArray<{ value: Status; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ value: Priority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const STATUS_LABELS = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.label]),
) as Record<Status, string>;

const PRIORITY_LABELS = Object.fromEntries(
  PRIORITY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<Priority, string>;

interface Filters {
  status: Status[];
  priority: Priority[];
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((existing) => existing !== value)
    : [...values, value];
}

function listPath({ status, priority }: Filters): string {
  const params = new URLSearchParams();

  if (status.length > 0) {
    params.set('status', status.join(','));
  }
  if (priority.length > 0) {
    params.set('priority', priority.join(','));
  }

  const query = params.toString();
  return query === '' ? '/api/tickets' : `/api/tickets?${query}`;
}

export default function TicketsPage() {
  // Null until a first load has answered. That is the only loading state:
  // static chrome is always on screen, and nothing pretends to be content.
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [failure, setFailure] = useState<FormErrors | null>(null);
  const [filters, setFilters] = useState<Filters>({ status: [], priority: [] });

  // A filter change starts a new fetch while an older one may still be in
  // flight; only the newest response may touch the table.
  const latestRequest = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    let active = true;

    void sessionRequest<Ticket[]>(listPath(filters)).then((result) => {
      if (!active || requestId !== latestRequest.current) {
        return;
      }

      if (result.ok) {
        setTickets(result.data);
        setFailure(null);
      } else {
        // The current rows stay exactly as they are; the banner is the news.
        setFailure(normalizeError(result.error, []));
      }
    });

    return () => {
      active = false;
    };
  }, [filters]);

  // First load only: a refetch keeps the current rows visible and unmarked.
  const firstLoadInFlight = tickets === null && failure === null;
  const hasFilters = filters.status.length > 0 || filters.priority.length > 0;

  return (
    <section aria-labelledby="tickets-heading">
      <h1 id="tickets-heading">Tickets</h1>

      <div role="group" aria-label="Filters">
        <fieldset>
          <legend>Status</legend>
          {STATUS_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                name="status"
                value={option.value}
                checked={filters.status.includes(option.value)}
                onChange={() =>
                  setFilters((current) => ({
                    ...current,
                    status: toggle(current.status, option.value),
                  }))
                }
              />{' '}
              {option.label}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Priority</legend>
          {PRIORITY_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                name="priority"
                value={option.value}
                checked={filters.priority.includes(option.value)}
                onChange={() =>
                  setFilters((current) => ({
                    ...current,
                    priority: toggle(current.priority, option.value),
                  }))
                }
              />{' '}
              {option.label}
            </label>
          ))}
        </fieldset>
      </div>

      {failure === null ? null : (
        <ErrorBanner
          messages={failure.banner}
          details={failure.statusCode >= 500 ? failure.details : undefined}
        />
      )}

      <div aria-busy={firstLoadInFlight ? true : undefined}>
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
            </tr>
          </thead>
          <tbody>
            {tickets === null ? null : tickets.length === 0 ? (
              <tr>
                <td colSpan={3}>{hasFilters ? 'No tickets match.' : 'No tickets yet.'}</td>
              </tr>
            ) : (
              tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td>
                    <Link href={`/tickets/${ticket.id}`}>{ticket.title}</Link>
                  </td>
                  <td>
                    <span className={`badge badge-${ticket.status}`}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${ticket.priority}`}>
                      {PRIORITY_LABELS[ticket.priority]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
