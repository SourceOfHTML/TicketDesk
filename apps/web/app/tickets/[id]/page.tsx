'use client';

import type { Comment, Status, Ticket, TicketDetail, UserRef } from '@ticketdesk/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorBanner } from '../../../components/error-banner';
import {
  FormField,
  RadioGroupField,
  SelectField,
  TextAreaField,
} from '../../../components/form-field';
import { useSession } from '../../../components/session-provider';
import { sessionRequest, type ApiResult } from '../../../lib/api';
import { emptyFormErrors, normalizeError, type FormErrors } from '../../../lib/form-errors';
import { PRIORITY_OPTIONS, STATUS_LABELS, STATUS_OPTIONS } from '../../../lib/ticket-labels';
import { PriorityBadge, StatusBadge } from '../../../components/ticket-badges';
import { useMutation } from '../../../lib/use-mutation';

/** The only form field a Comment's errors may be attached to. */
const COMMENT_FIELDS = ['body'] as const;

/** Each Priority is drawn exactly as the raise form draws it. */
const PRIORITY_CHOICES = PRIORITY_OPTIONS.map((option) => ({
  value: option.value,
  label: <PriorityBadge priority={option.value} />,
}));

/** Each Status is drawn exactly as the Ticket itself shows it. */
const STATUS_CHOICES = STATUS_OPTIONS.map((option) => ({
  value: option.value,
  label: <StatusBadge status={option.value} />,
}));

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
 * Staff-only: the two direct PATCH controls, each freezing only itself, and the
 * status form, which freezes as a whole. The panel is presentation; the API
 * refuses a Requester whatever the UI renders.
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

      <PriorityControl ticket={ticket} onChanged={onChanged} />

      <AssigneeControl
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

      <StatusForm ticket={ticket} onChanged={onChanged} />
    </section>
  );
}

interface DirectWrite<T> {
  write: (next: T) => Promise<void>;
  pending: boolean;
  errors: FormErrors | null;
}

/**
 * The one direct-write lifecycle. The chosen value goes into a ref so the write
 * in this same event sees it; the control stays bound to the Ticket, so a
 * failure leaves the server's value visible and a success swaps it after the
 * refetch.
 */
function useDirectWrite<T>(
  value: T,
  save: (value: T) => Promise<ApiResult<Ticket>>,
  onSaved: () => void,
): DirectWrite<T> {
  const [errors, setErrors] = useState<FormErrors | null>(null);
  const pendingValue = useRef(value);

  const mutation = useMutation(() => save(pendingValue.current), {
    onSuccess: () => {
      setErrors(null);
      onSaved();
    },
  });

  async function write(next: T): Promise<void> {
    if (mutation.pending) {
      return;
    }

    pendingValue.current = next;
    setErrors(null);
    const result = await mutation.run();

    if (result !== undefined && !result.ok) {
      setErrors(normalizeError(result.error, []));
    }
  }

  return { write, pending: mutation.pending, errors };
}

/** A direct write's failure, in the banner its control renders beside it. */
function DirectWriteFailure({ errors }: { errors: FormErrors | null }) {
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

/**
 * Staff-only: Priority as the same radio group and badges the raise form
 * offers. One choice writes immediately; the group stays bound to the Ticket.
 */
function PriorityControl({ ticket, onChanged }: { ticket: TicketDetail; onChanged: () => void }) {
  const { write, pending, errors } = useDirectWrite(
    ticket.priority,
    (priority) =>
      sessionRequest<Ticket>(`/api/tickets/${encodeURIComponent(ticket.id)}/priority`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ priority }),
      }),
    onChanged,
  );

  return (
    <div className="staff-control" aria-busy={pending ? true : undefined}>
      <RadioGroupField
        id="staff-priority"
        label="Priority"
        value={ticket.priority}
        options={PRIORITY_CHOICES}
        onChange={(priority) => void write(priority)}
        disabled={pending}
      />
      <DirectWriteFailure errors={errors} />
    </div>
  );
}

interface AssigneeControlProps {
  /** The Ticket's current Assignee, or `''` for none. */
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled: boolean;
  /** One chosen value, written by a direct PATCH. */
  save: (value: string) => Promise<ApiResult<Ticket>>;
  onSaved: () => void;
}

/** Staff-only: naming the Assignee, or leaving the Ticket unassigned. */
function AssigneeControl({ value, options, disabled, save, onSaved }: AssigneeControlProps) {
  const { write, pending, errors } = useDirectWrite(value, save, onSaved);

  return (
    <div className="staff-control" aria-busy={pending ? true : undefined}>
      <SelectField
        id="staff-assignee"
        label="Assignee"
        value={value}
        options={options}
        onChange={(next) => void write(next)}
        disabled={pending || disabled}
      />
      <DirectWriteFailure errors={errors} />
    </div>
  );
}

/** The only fields a message may be attached to on the status form. */
const STATUS_FORM_FIELDS = ['status', 'reason'] as const;

interface StatusFormProps {
  ticket: TicketDetail;
  /** Refetches the Ticket, so the history shows the move the server recorded. */
  onChanged: () => void;
}

/**
 * Staff-only: one form for the whole move. The radio group offers all four
 * Statuses, with the Ticket's current one chosen, and knows no rule about which
 * moves are legal — an illegal target is the API's 400 in the banner, not a
 * hidden option here. The whole form freezes while writing, so one submission
 * can never record two Status Changes.
 */
function StatusForm({ ticket, onChanged }: StatusFormProps) {
  // The group starts on the Status the Ticket is in, and follows it whenever a
  // move is recorded. A refusal leaves the chosen target where it was.
  const [status, setStatus] = useState<Status>(ticket.status);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FormErrors>(emptyFormErrors);

  // The reason is asked for only where the rule demands one: a closed Ticket
  // coming back. A hidden field is never sent, so no other move carries it.
  const reasonRequired = ticket.status === 'closed' && status === 'open';
  // Re-picking the current Status changes nothing, so there is no move to send.
  const unchanged = status === ticket.status;

  const mutation = useMutation(
    () =>
      sessionRequest<Ticket>(`/api/tickets/${encodeURIComponent(ticket.id)}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reasonRequired ? { status, reason } : { status }),
      }),
    {
      // Only a recorded move clears the reason and settles on the server's new
      // Status; a refusal leaves the chosen target and the typed reason.
      onSuccess: (updated) => {
        setStatus(updated.status);
        setReason('');
        onChanged();
      },
    },
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (mutation.pending || unchanged) {
      return;
    }

    setErrors(emptyFormErrors());
    const result = await mutation.run();

    if (result !== undefined && !result.ok) {
      setErrors(normalizeError(result.error, STATUS_FORM_FIELDS));
      // The read rule applies to a failure too: the Ticket may have been moved
      // or deleted under us. The chosen Status and typed reason survive.
      onChanged();
    }
  }

  return (
    <form
      className="staff-control"
      onSubmit={onSubmit}
      noValidate
      aria-busy={mutation.pending ? true : undefined}
    >
      <ErrorBanner
        messages={errors.banner}
        details={errors.statusCode >= 500 ? errors.details : undefined}
      />
      <RadioGroupField
        id="staff-status"
        label="Status"
        value={status}
        options={STATUS_CHOICES}
        onChange={setStatus}
        errors={errors.fields.status}
        disabled={mutation.pending}
      />
      {reasonRequired ? (
        <FormField
          id="staff-status-reason"
          label="Reason for re-opening"
          value={reason}
          onChange={setReason}
          errors={errors.fields.reason}
          disabled={mutation.pending}
          // Rendered only when the rule requires it; the label alone would not
          // tell a screen reader so.
          ariaRequired
        />
      ) : null}
      <button type="submit" disabled={mutation.pending || unchanged}>
        Update status
      </button>
    </form>
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
