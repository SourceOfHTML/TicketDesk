'use client';

import type { TicketDetail } from '@ticketdesk/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorBanner } from '../../../components/error-banner';
import { sessionRequest } from '../../../lib/api';
import { normalizeError, type FormErrors } from '../../../lib/form-errors';
import { PRIORITY_LABELS, STATUS_LABELS } from '../../../lib/ticket-labels';

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  // Null until the fetch answers. That is the only loading state: static chrome
  // is always on screen, and nothing pretends to be content.
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [failure, setFailure] = useState<FormErrors | null>(null);
  // A 404 is a definitive answer, not a failed load, so it is its own state.
  const [notFound, setNotFound] = useState(false);
  const [requestInFlight, setRequestInFlight] = useState(true);

  useEffect(() => {
    let active = true;
    setTicket(null);
    setFailure(null);
    setNotFound(false);
    setRequestInFlight(true);

    void sessionRequest<TicketDetail>(`/api/tickets/${encodeURIComponent(id)}`)
      .then((result) => {
        if (!active) {
          return;
        }

        if (result.ok) {
          setTicket(result.data);
        } else if (result.error.statusCode === 404) {
          setNotFound(true);
        } else {
          setFailure(normalizeError(result.error, []));
        }
      })
      .finally(() => {
        if (active) {
          setRequestInFlight(false);
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  if (notFound) {
    return (
      <section>
        <h1>Ticket not found</h1>
        <p>This ticket doesn&apos;t exist, or the link is wrong.</p>
        <p>
          <Link href="/tickets">Back to tickets</Link>
        </p>
      </section>
    );
  }

  // Unknown data waits, and only a first load is unknown; a refetch keeps the
  // current Ticket visible and unmarked.
  const firstLoadInFlight = ticket === null && requestInFlight;

  return (
    <section>
      {failure === null ? null : (
        <>
          <ErrorBanner
            messages={failure.banner}
            details={failure.statusCode >= 500 ? failure.details : undefined}
          />
          {failure.statusCode === 403 ? (
            <p>
              <Link href="/tickets">Back to tickets</Link>
            </p>
          ) : null}
        </>
      )}

      <div aria-busy={firstLoadInFlight ? true : undefined}>
        {ticket === null ? null : (
          <article className="ticket" aria-labelledby="ticket-heading">
            <h1 id="ticket-heading">{ticket.title}</h1>
            <p className="ticket-description">{ticket.description}</p>

            <dl className="ticket-meta">
              <dt>Status</dt>
              <dd>
                <span className={`badge badge-${ticket.status}`}>
                  {STATUS_LABELS[ticket.status]}
                </span>
              </dd>
              <dt>Priority</dt>
              <dd>
                <span className={`badge badge-${ticket.priority}`}>
                  {PRIORITY_LABELS[ticket.priority]}
                </span>
              </dd>
              <dt>Requester</dt>
              <dd>{ticket.creator.email}</dd>
              <dt>Assignee</dt>
              <dd>{ticket.assignee === null ? 'Unassigned' : ticket.assignee.email}</dd>
            </dl>

            <section className="ticket-section" aria-labelledby="comments-heading">
              <h2 id="comments-heading">Comments</h2>
              {ticket.comments.length === 0 ? (
                <p>No comments yet.</p>
              ) : (
                <ul>
                  {ticket.comments.map((comment) => (
                    <li key={comment.id}>
                      <p>{comment.body}</p>
                      <p className="ticket-byline">
                        {comment.author.email} · <Time iso={comment.createdAt} />
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="ticket-section" aria-labelledby="status-changes-heading">
              <h2 id="status-changes-heading">Status changes</h2>
              {ticket.statusChanges.length === 0 ? (
                <p>No status changes yet.</p>
              ) : (
                <ul>
                  {ticket.statusChanges.map((change) => (
                    <li key={change.id}>
                      <p>
                        {STATUS_LABELS[change.fromStatus]} → {STATUS_LABELS[change.toStatus]}
                      </p>
                      {change.reason === null ? null : <p>{change.reason}</p>}
                      <p className="ticket-byline">
                        {change.changedBy.email} · <Time iso={change.createdAt} />
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </article>
        )}
      </div>
    </section>
  );
}

function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>;
}
