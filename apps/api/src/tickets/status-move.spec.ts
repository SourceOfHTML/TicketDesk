import type { Status } from '@ticketdesk/shared';
import { describe, expect, it } from 'vitest';
import { checkStatusMove } from './status-move';

const STATUSES = ['open', 'in-progress', 'resolved', 'closed'] as const;

/**
 * The spec's table, transcribed from issue #30 — not from the implementation.
 * Everything not on it is an illegal move.
 */
const LEGAL_MOVES: ReadonlyArray<readonly [Status, Status]> = [
  ['open', 'in-progress'],
  ['in-progress', 'open'],
  ['in-progress', 'resolved'],
  ['resolved', 'in-progress'],
  ['resolved', 'closed'],
  ['closed', 'open'],
];

function isLegal(from: Status, to: Status): boolean {
  return LEGAL_MOVES.some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to);
}

describe('checkStatusMove', () => {
  // All 16 pairs, twice: Staff are decided by the table, and a Requester is
  // refused on every pair — the Role is the first question, not the last.
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      it(`Staff: ${from} → ${to}`, () => {
        // Every Ticket here has an Assignee, so this loop is about the moves
        // alone; the Assignee requirement has its own block below.
        const verdict = checkStatusMove(from, to, 'STAFF', undefined, true);

        if (isLegal(from, to) && !(from === 'closed' && to === 'open')) {
          expect(verdict).toEqual({ ok: true, reason: null });
        } else if (from === 'closed' && to === 'open') {
          // The reason requirement has its own block below.
          expect(verdict).toEqual({
            ok: false,
            refusal: 'reason-required',
            message: 'A reason is required to re-open a closed ticket.',
          });
        } else {
          expect(verdict).toEqual({
            ok: false,
            refusal: 'illegal',
            message: `Cannot move a ticket from ${from} to ${to}.`,
          });
        }
      });

      it(`Requester: ${from} → ${to}`, () => {
        expect(checkStatusMove(from, to, 'USER', 'Plausible reason', true)).toEqual({
          ok: false,
          refusal: 'not-staff',
          message: 'Staff only',
        });
      });
    }
  }

  describe('the Assignee requirement', () => {
    it('refuses open → in-progress without an Assignee', () => {
      expect(checkStatusMove('open', 'in-progress', 'STAFF', undefined, false)).toEqual({
        ok: false,
        refusal: 'assignee-required',
        message: 'A ticket needs an Assignee before it can move to in-progress.',
      });
    });

    it('allows open → in-progress once an Assignee is named', () => {
      expect(checkStatusMove('open', 'in-progress', 'STAFF', undefined, true)).toEqual({
        ok: true,
        reason: null,
      });
    });

    it('asks for no Assignee on any other legal move', () => {
      for (const [from, to] of LEGAL_MOVES) {
        if (from === 'open' && to === 'in-progress') {
          continue;
        }

        const reason = from === 'closed' && to === 'open' ? 'Back again.' : undefined;

        expect(checkStatusMove(from, to, 'STAFF', reason, false), `${from} → ${to}`).toMatchObject({
          ok: true,
        });
      }
    });
  });

  describe('the re-open reason', () => {
    it('refuses closed → open with no reason', () => {
      expect(checkStatusMove('closed', 'open', 'STAFF', undefined, true)).toEqual({
        ok: false,
        refusal: 'reason-required',
        message: 'A reason is required to re-open a closed ticket.',
      });
    });

    it('refuses closed → open with an empty or whitespace-only reason', () => {
      for (const reason of ['', ' ', '\n\t ']) {
        expect(checkStatusMove('closed', 'open', 'STAFF', reason, true)).toEqual({
          ok: false,
          refusal: 'reason-required',
          message: 'A reason is required to re-open a closed ticket.',
        });
      }
    });

    it('records the reason, trimmed, when one is given', () => {
      expect(checkStatusMove('closed', 'open', 'STAFF', '  Customer replied.  ', true)).toEqual({
        ok: true,
        reason: 'Customer replied.',
      });
    });
  });

  it('records a reason given on any other legal move', () => {
    expect(checkStatusMove('open', 'in-progress', 'STAFF', ' Picking this up. ', true)).toEqual({
      ok: true,
      reason: 'Picking this up.',
    });
  });

  it('treats an empty reason on a move that does not need one as no reason', () => {
    expect(checkStatusMove('resolved', 'closed', 'STAFF', '   ', true)).toEqual({
      ok: true,
      reason: null,
    });
  });
});
