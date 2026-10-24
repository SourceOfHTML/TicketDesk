'use client';

import {
  ticketListQueryString,
  type Ticket,
  type TicketListQuery,
  type UserRef,
} from '@ticketdesk/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorBanner } from '../../components/error-banner';
import { useSession } from '../../components/session-provider';
import { PriorityBadge, StatusBadge } from '../../components/ticket-badges';
import { sessionRequest } from '../../lib/api';
import { normalizeError, type FormErrors } from '../../lib/form-errors';
import { PRIORITY_OPTIONS, STATUS_OPTIONS } from '../../lib/ticket-labels';

/** The shared query's shape, with every filter always present. */
type Filters = Required<TicketListQuery>;

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((existing) => existing !== value)
    : [...values, value];
}

/** Nothing selected, every filter present. */
function emptyFilters(): Filters {
  return { status: [], priority: [], assigneeId: [] };
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

/** A failed read: the banner, with details only for a 5xx. */
function LoadFailure({ errors }: { errors: FormErrors | null }) {
  if (errors === null) {
    return null;
  }

  return (
    <ErrorBanner
      messages={errors.banner}
      details={errors.statusCode >= 500 ? errors.details : undefined}
    />
  );
}

export default function TicketsPage() {
  const { user } = useSession();
  // The role is unknown until `/me` answers — and it is null then — so no
  // Staff control renders before it arrives.
  const isStaff = user?.role === 'STAFF';

  // Null until a first load has answered. That is the only loading state:
  // static chrome is always on screen, and nothing pretends to be content.
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [failure, setFailure] = useState<FormErrors | null>(null);
  // The Assignee picker's options, fetched only for Staff.
  const [staff, setStaff] = useState<UserRef[] | null>(null);
  const [staffFailure, setStaffFailure] = useState<FormErrors | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // Which filters produced the rows on screen, so the empty message describes
  // the response rather than a selection still in flight.
  const [loadedFilters, setLoadedFilters] = useState<Filters>(emptyFilters);
  const [requestInFlight, setRequestInFlight] = useState(true);

  function toggleFilter<K extends keyof Filters>(key: K, value: Filters[K][number]): void {
    setFilters((current) => ({ ...current, [key]: toggle(current[key], value) }));
  }

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

  // The directory is Staff-only, so a Requester's page never asks for it.
  useEffect(() => {
    if (!isStaff) {
      return;
    }

    let active = true;

    void sessionRequest<UserRef[]>('/api/staff').then((result) => {
      if (!active) {
        return;
      }

      if (result.ok) {
        setStaff(result.data);
        setStaffFailure(null);
      } else {
        setStaffFailure(normalizeError(result.error, []));
      }
    });

    return () => {
      active = false;
    };
  }, [isStaff]);

  // Unknown data waits, and only a list with no rows is unknown: a refetch
  // keeps the current rows visible and unmarked.
  const firstLoadInFlight = tickets === null && requestInFlight;
  const hasFilters =
    loadedFilters.status.length > 0 ||
    loadedFilters.priority.length > 0 ||
    loadedFilters.assigneeId.length > 0;
  const staffOptions =
    staff === null ? null : staff.map((member) => ({ value: member.id, label: member.email }));

  return (
    <section aria-labelledby="tickets-heading">
      <h1 id="tickets-heading">Tickets</h1>

      <p>
        <Link href="/tickets/new">Raise a ticket</Link>
      </p>

      <LoadFailure errors={staffFailure} />

      <div role="group" aria-label="Filters">
        <FilterFieldset
          name="status"
          legend="Status"
          options={STATUS_OPTIONS}
          selected={filters.status}
          onToggle={(status) => toggleFilter('status', status)}
        />

        <FilterFieldset
          name="priority"
          legend="Priority"
          options={PRIORITY_OPTIONS}
          selected={filters.priority}
          onToggle={(priority) => toggleFilter('priority', priority)}
        />

        {/* No options yet means no filter: an empty fieldset would only mislead. */}
        {staffOptions === null ? null : (
          <FilterFieldset
            name="assigneeId"
            legend="Assignee"
            options={staffOptions}
            selected={filters.assigneeId}
            onToggle={(assigneeId) => toggleFilter('assigneeId', assigneeId)}
          />
        )}
      </div>

      <LoadFailure errors={failure} />

      <div aria-busy={firstLoadInFlight ? true : undefined}>
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
              {isStaff ? <th scope="col">Assignee</th> : null}
            </tr>
          </thead>
          <tbody>
            {tickets === null ? null : tickets.length === 0 ? (
              <tr>
                <td colSpan={isStaff ? 4 : 3}>
                  {hasFilters ? 'No tickets match.' : 'No tickets yet.'}
                </td>
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
                  {isStaff ? (
                    <td>{ticket.assignee === null ? 'Unassigned' : ticket.assignee.email}</td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
