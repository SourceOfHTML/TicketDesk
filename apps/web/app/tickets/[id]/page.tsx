'use client';

import type { Comment, TicketDetail } from '@ticketdesk/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorBanner } from '../../../components/error-banner';
import { TextAreaField } from '../../../components/form-field';
import { sessionRequest } from '../../../lib/api';
import { emptyFormErrors, normalizeError, type FormErrors } from '../../../lib/form-errors';
import { STATUS_LABELS } from '../../../lib/ticket-labels';
import { PriorityBadge, StatusBadge } from '../../../components/ticket-badges';
import { useMutation } from '../../../lib/use-mutation';

/** The only field a Comment message may be attached to. */
const COMMENT_FIELDS = ['body'] as const;

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  // Null until the fetch answers. That is the only loading state: static chrome
  // is always on screen, and nothing pretends to be content.
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [failure, setFailure] = useState<FormErrors | null>(null);
  // A 404 is a definitive answer, not a failed load, so it is its own state.
  const [notFound, setNotFound] = useState(false);
  const [requestInFlight, setRequestInFlight] = useState(true);
  // Bumped when a Comment is posted. The same fetch already knows how to load
  // the thread, so posting clears the composer and asks it again.
  const [threadVersion, setThreadVersion] = useState(0);

  // A different Ticket starts from nothing; a refetch of the same one keeps it
  // on screen, unmarked.
  useEffect(() => {
    setTicket(null);
    setFailure(null);
    setNotFound(false);
  }, [id]);

  useEffect(() => {
    let active = true;
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
  }, [id, threadVersion]);

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
          <>
            <article className="ticket" aria-labelledby="ticket-heading">
              <h1 id="ticket-heading">{ticket.title}</h1>
              <p className="ticket-description">{ticket.description}</p>

              <dl className="ticket-meta">
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={ticket.status} />
                </dd>
                <dt>Priority</dt>
                <dd>
                  <PriorityBadge priority={ticket.priority} />
                </dd>
                <dt>Requester</dt>
                <dd>{ticket.creator.email}</dd>
                <dt>Assignee</dt>
                <dd>{ticket.assignee === null ? 'Unassigned' : ticket.assignee.email}</dd>
              </dl>
            </article>

            <section className="ticket-comments" aria-labelledby="comments-heading">
              <h2 id="comments-heading">Comments</h2>
              {ticket.comments.length === 0 ? (
                <p>No comments yet.</p>
              ) : (
                <ul role="list" className="comment-list">
                  {ticket.comments.map((comment) => (
                    <li key={comment.id} className="comment">
                      <p className="comment-meta">
                        <strong>{comment.author.email}</strong>
                        <Time iso={comment.createdAt} />
                      </p>
                      <p className="comment-body">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              {/* A closed Ticket takes no new Comments; the API refuses them
                  even if this control is brought back by hand. */}
              {ticket.status === 'closed' ? null : (
                <CommentComposer
                  ticketId={ticket.id}
                  onPosted={() => setThreadVersion((version) => version + 1)}
                />
              )}
            </section>

            <section className="ticket-history" aria-labelledby="status-changes-heading">
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
          </>
        )}
      </div>
    </section>
  );
}

function CommentComposer({ ticketId, onPosted }: { ticketId: string; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<FormErrors>(emptyFormErrors);

  const mutation = useMutation(
    () =>
      sessionRequest<Comment>(`/api/tickets/${encodeURIComponent(ticketId)}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      }),
    {
      // Only a written Comment clears the box; the thread is refetched so the
      // new Comment arrives with the server's own ordering and timestamps.
      onSuccess: () => {
        setBody('');
        onPosted();
      },
    },
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (mutation.pending) {
      return;
    }

    setErrors(emptyFormErrors());
    const result = await mutation.run();

    // A failed post keeps the typed body: nothing was written, so the text is
    // still the author's to fix or retry.
    if (result !== undefined && !result.ok) {
      setErrors(normalizeError(result.error, COMMENT_FIELDS));
    }
  }

  return (
    <form
      className="comment-form"
      onSubmit={onSubmit}
      noValidate
      aria-busy={mutation.pending ? true : undefined}
    >
      <ErrorBanner
        messages={errors.banner}
        details={errors.statusCode >= 500 ? errors.details : undefined}
      />
      <TextAreaField
        id="comment-body"
        label="Add a comment"
        value={body}
        onChange={setBody}
        errors={errors.fields.body}
        disabled={mutation.pending}
      />
      <button type="submit" disabled={mutation.pending}>
        Post comment
      </button>
    </form>
  );
}

function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>;
}
