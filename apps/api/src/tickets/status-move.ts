import type { Role, Status } from '@ticketdesk/shared';

/**
 * The six moves a Ticket may make, and nothing else. Nothing reaches `resolved`
 * without passing through `in-progress`; the only way out of `open` is
 * `in-progress`; and the only way back into a closed Ticket's life is `open`.
 */
const LEGAL_MOVES: ReadonlyArray<readonly [Status, Status]> = [
  ['open', 'in-progress'],
  ['in-progress', 'open'],
  ['in-progress', 'resolved'],
  ['resolved', 'in-progress'],
  ['resolved', 'closed'],
  ['closed', 'open'],
];

/** Why a move was refused. The service turns each into its own HTTP answer. */
export type StatusMoveRefusal = 'not-staff' | 'illegal' | 'assignee-required' | 'reason-required';

/**
 * A legal move carries the reason the Status Change records, already trimmed; a
 * refusal carries the message the API answers with.
 */
export type StatusMoveVerdict =
  { ok: true; reason: string | null } | { ok: false; refusal: StatusMoveRefusal; message: string };

/**
 * Whether a Ticket may move between two Statuses. A pure rule — no database and
 * no HTTP — so all 16 pairs can be checked without anything else in the way.
 *
 * The Role is asked first: a Requester may make no move at all, legal or not.
 * `open → in-progress` needs an Assignee — work nobody owns cannot start — and
 * `closed → open` needs a reason that survives trimming; every other move may
 * carry a reason, and an empty one is recorded as none.
 */
export function checkStatusMove(
  from: Status,
  to: Status,
  actorRole: Role,
  reason: string | null | undefined,
  hasAssignee: boolean,
): StatusMoveVerdict {
  if (actorRole !== 'STAFF') {
    return { ok: false, refusal: 'not-staff', message: 'Staff only' };
  }

  const recordedReason = reason?.trim() ?? '';
  const normalizedReason = recordedReason === '' ? null : recordedReason;

  const isLegal = LEGAL_MOVES.some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to);

  if (!isLegal) {
    return {
      ok: false,
      refusal: 'illegal',
      message: `Cannot move a ticket from ${from} to ${to}.`,
    };
  }

  if (from === 'open' && to === 'in-progress' && !hasAssignee) {
    return {
      ok: false,
      refusal: 'assignee-required',
      message: 'A ticket needs an Assignee before it can move to in-progress.',
    };
  }

  if (from === 'closed' && to === 'open' && normalizedReason === null) {
    return {
      ok: false,
      refusal: 'reason-required',
      message: 'A reason is required to re-open a closed ticket.',
    };
  }

  return { ok: true, reason: normalizedReason };
}
