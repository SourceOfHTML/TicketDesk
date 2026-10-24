'use client';

import type { Comment, Ticket, TicketDetail, UserRef } from '@ticketdesk/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorBanner } from '../../../components/error-banner';
import { TextAreaField } from '../../../components/form-field';
import { useSession } from '../../../components/session-provider';
import { sessionRequest, type ApiResult } from '../../../lib/api';
import { emptyFormErrors, normalizeError, type FormErrors } from '../../../lib/form-errors';
import { PRIORITY_OPTIONS, STATUS_LABELS } from '../../../lib/ticket-labels';
import { PriorityBadge, StatusBadge } from '../../../components/ticket-badges';
import { useMutation } from '../../../lib/use-mutation';

/** The only form field a Comment's errors may be attached to. */
const COMMENT_FIELDS = ['body'] as const;

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  // Null until `/me` answers — and null then — so no Staff control renders
  // before the Role is known.
  const { user } = useSession();
  const isStaff = user?.role === 'STAFF';

  // Null until the fetch answers. That is the only loading state: static chrome
  // is always on screen, and nothing pretends to be content.
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [failure, setFailure] = useState<FormErrors | null>(null);
  // A 404 is a definitive answer, not a failed load, so it is its own state.
  const [notFound, setNotFound] = useState(false);
  const [requestInFlight, setRequestInFlight] = useState(true);
  // The Staff directory for the assignee picker. Fetched only once the Ticket
  // has loaded, and only for Staff.
  const [staff, setStaff] = useState<UserRef[] | null>(null);
  const [staffFailure, setStaffFailure] = useState<FormErrors | null>(null);
  // Bumped when a write lands. The same fetch already knows how to load the
  // Ticket, so a posted Comment or a changed Priority or Assignee asks it again
  // without clearing what is on screen.
  const [reloadVersion, setReloadVersion] = useState(0);

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
          // A refetch that works replaces the thread and the failure that kept
          // it from loading; a stale banner must not outlive its cause.
          setTicket(result.data);
          setFailure(null);
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
  }, [id, reloadVersion]);

  // The directory the picker offers. The Ticket fetch comes first: until it
  // succeeds there is no Staff panel to fill.
  const ticketLoaded = ticket !== null;

  useEffect(() => {
    if (!isStaff || !ticketLoaded) {
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
  }, [isStaff, ticketLoaded]);

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

            {isStaff ? (
              <StaffPanel
                ticket={ticket}
                staff={staff}
                directoryFailure={staffFailure}
                onChanged={() => setReloadVersion((version) => version + 1)}
              />
            ) : null}

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
                  onPosted={() => setReloadVersion((version) => version + 1)}
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

interface StaffPanelProps {
  ticket: TicketDetail;
  /** Null until the directory answers; a failed fetch leaves it null. */
  staff: UserRef[] | null;
  directoryFailure: FormErrors | null;
  /** Refetches the Ticket, so both controls show the server's own values. */
  onChanged: () => void;
}

/**
 * Staff-only: the two direct PATCH controls, each freezing only itself. The
 * panel is presentation; the API refuses a Requester whatever the UI renders.
 */
function StaffPanel({ ticket, staff, directoryFailure, onChanged }: StaffPanelProps) {
  // Everyone the picker may name. The current Assignee is always present, even
  // while the directory is still unknown, so the picker never misreports.
  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...(ticket.assignee === null
      ? []
      : [{ value: ticket.assignee.id, label: ticket.assignee.email }]),
    ...(staff ?? [])
      .filter((member) => member.id !== ticket.assignee?.id)
      .map((member) => ({ value: member.id, label: member.email })),
  ];

  return (
    <section className="staff-panel" aria-labelledby="staff-panel-heading">
      <h2 id="staff-panel-heading">Staff</h2>

      {directoryFailure === null ? null : (
        <ErrorBanner
          messages={directoryFailure.banner}
          details={directoryFailure.statusCode >= 500 ? directoryFailure.details : undefined}
        />
      )}

      <StaffControl
        id="staff-priority"
        label="Priority"
        value={ticket.priority}
        options={PRIORITY_OPTIONS}
        save={(priority) =>
          sessionRequest<Ticket>(`/api/tickets/${encodeURIComponent(ticket.id)}/priority`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ priority }),
          })
        }
        onSaved={onChanged}
      />

      <StaffControl
        id="staff-assignee"
        label="Assignee"
        value={ticket.assignee?.id ?? ''}
        options={assigneeOptions}
        // Without the directory the picker can only offer the current Assignee
        // and unassigning, so it waits for the full list before it writes.
        disabled={staff === null}
        save={(assigneeId) =>
          sessionRequest<Ticket>(`/api/tickets/${encodeURIComponent(ticket.id)}/assign`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ assigneeId: assigneeId === '' ? null : assigneeId }),
          })
        }
        onSaved={onChanged}
      />
    </section>
  );
}

interface StaffControlProps {
  id: string;
  label: string;
  /** The Ticket's current value. The select always shows the server's answer. */
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  /** One chosen value, written by a direct PATCH. */
  save: (value: string) => Promise<ApiResult<Ticket>>;
  onSaved: () => void;
}

/**
 * One direct PATCH control. The chosen value goes into a ref so the write in
 * this same event sees it; the select stays bound to the Ticket, so a failure
 * leaves the current value visible and a success swaps it after the refetch.
 */
function StaffControl({
  id,
  label,
  value,
  options,
  disabled = false,
  save,
  onSaved,
}: StaffControlProps) {
  const [errors, setErrors] = useState<FormErrors | null>(null);
  const chosen = useRef(value);

  const mutation = useMutation(() => save(chosen.current), {
    onSuccess: () => {
      setErrors(null);
      onSaved();
    },
  });

  async function onChange(next: string): Promise<void> {
    if (mutation.pending) {
      return;
    }

    chosen.current = next;
    setErrors(null);
    const result = await mutation.run();

    if (result !== undefined && !result.ok) {
      setErrors(normalizeError(result.error, []));
    }
  }

  return (
    <div className="staff-control" aria-busy={mutation.pending ? true : undefined}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={id}
        value={value}
        disabled={mutation.pending || disabled}
        onChange={(event) => void onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {errors === null ? null : (
        <ErrorBanner
          messages={errors.banner}
          details={errors.statusCode >= 500 ? errors.details : undefined}
        />
      )}
    </div>
  );
}

function CommentComposer({ ticketId, onPosted }: { ticketId: string; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<FormErrors>(emptyFormErrors);
  // The thread appears above the composer, out of the reader's way; a written
  // Comment is announced rather than left to be noticed.
  const [posted, setPosted] = useState(false);

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
        setPosted(true);
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
    setPosted(false);
    const result = await mutation.run();

    // A failed submission keeps the typed body: nothing was written, so the
    // text is still the author's to fix or retry.
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
      {posted ? <p role="status">Comment posted.</p> : null}
    </form>
  );
}

function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>;
}
