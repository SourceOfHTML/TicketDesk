'use client';

import { ticketListQueryString, type Ticket, type TicketListQuery } from '@ticketdesk/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorBanner } from '../../components/error-banner';
import { PriorityBadge, StatusBadge } from '../../components/ticket-badges';
import { sessionRequest } from '../../lib/api';
import { normalizeError, type FormErrors } from '../../lib/form-errors';
import { PRIORITY_OPTIONS, STATUS_OPTIONS } from '../../lib/ticket-labels';

/** The shared query's shape, with both filters always present. */
type Filters = Required<TicketListQuery>;

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((existing) => existing !== value)
    : [...values, value];
}

function listPath(filters: Filters): string {
  const query = ticketListQueryString(filters);
  return query === '' ? '/api/tickets' : `/api/tickets?${query}`;
}

interface FilterFieldsetProps<T extends string> {
  name: string;
  legend: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: T[];
  onToggle: (value: T) => void;
}

function FilterFieldset<T extends string>({
  name,
  legend,
  options,
  selected,
  onToggle,
}: FilterFieldsetProps<T>) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            name={name}
            value={option.value}
            checked={selected.includes(option.value)}
            onChange={() => onToggle(option.value)}
          />{' '}
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

export default function TicketsPage() {
  // Null until a first load has answered. That is the only loading state:
  // static chrome is always on screen, and nothing pretends to be content.
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [failure, setFailure] = useState<FormErrors | null>(null);
  const [filters, setFilters] = useState<Filters>({ status: [], priority: [] });
  // Which filters produced the rows on screen, so the empty message describes
  // the response rather than a selection still in flight.
  const [loadedFilters, setLoadedFilters] = useState<Filters>({ status: [], priority: [] });
  const [requestInFlight, setRequestInFlight] = useState(true);

  // A filter change starts a new fetch while an older one may still be in
  // flight; only the newest response may touch the table.
  const latestRequest = useRef(0);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    let active = true;
    setRequestInFlight(true);

    void sessionRequest<Ticket[]>(listPath(filters))
      .then((result) => {
        if (!active || requestId !== latestRequest.current) {
          return;
        }

        if (result.ok) {
          setTickets(result.data);
          setLoadedFilters(filters);
          setFailure(null);
        } else {
          // The current rows stay exactly as they are; the banner is the news.
          setFailure(normalizeError(result.error, []));
        }
      })
      .finally(() => {
        if (requestId === latestRequest.current) {
          setRequestInFlight(false);
        }
      });

    return () => {
      active = false;
    };
  }, [filters]);

  // Unknown data waits, and only a list with no rows is unknown: a refetch
  // keeps the current rows visible and unmarked.
  const firstLoadInFlight = tickets === null && requestInFlight;
  const hasFilters = loadedFilters.status.length > 0 || loadedFilters.priority.length > 0;

  return (
    <section aria-labelledby="tickets-heading">
      <h1 id="tickets-heading">Tickets</h1>

      <p>
        <Link href="/tickets/new">Raise a ticket</Link>
      </p>

      <div role="group" aria-label="Filters">
        <FilterFieldset
          name="status"
          legend="Status"
          options={STATUS_OPTIONS}
          selected={filters.status}
          onToggle={(status) =>
            setFilters((current) => ({ ...current, status: toggle(current.status, status) }))
          }
        />

        <FilterFieldset
          name="priority"
          legend="Priority"
          options={PRIORITY_OPTIONS}
          selected={filters.priority}
          onToggle={(priority) =>
            setFilters((current) => ({
              ...current,
              priority: toggle(current.priority, priority),
            }))
          }
        />
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
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td>
                    <PriorityBadge priority={ticket.priority} />
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
