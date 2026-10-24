import type { Status } from '@ticketdesk/shared';
import { describe, expect, it } from 'vitest';
import { checkStatusTransition } from './status-transition';

const STATUSES = ['open', 'in-progress', 'resolved', 'closed'] as const;

/**
 * The spec's table, transcribed from issue #30 — not from the implementation.
 * Everything not on it is an illegal move.
 */
const LEGAL_TRANSITIONS: ReadonlyArray<readonly [Status, Status]> = [
  ['open', 'in-progress'],
  ['in-progress', 'open'],
  ['in-progress', 'resolved'],
  ['resolved', 'in-progress'],
  ['resolved', 'closed'],
  ['closed', 'open'],
];

function isLegal(from: Status, to: Status): boolean {
  return LEGAL_TRANSITIONS.some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to);
}

describe('checkStatusTransition', () => {
  // All 16 pairs, twice: Staff are decided by the table, and a Requester is
  // refused on every pair — the Role is the first question, not the last.
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      it(`Staff: ${from} → ${to}`, () => {
        const verdict = checkStatusTransition(from, to, 'STAFF', undefined);

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
        expect(checkStatusTransition(from, to, 'USER', 'Plausible reason')).toEqual({
          ok: false,
          refusal: 'not-staff',
          message: 'Staff only',
        });
      });
    }
  }

  describe('the re-open reason', () => {
    it('refuses closed → open with no reason', () => {
      expect(checkStatusTransition('closed', 'open', 'STAFF', undefined)).toEqual({
        ok: false,
        refusal: 'reason-required',
        message: 'A reason is required to re-open a closed ticket.',
      });
    });

    it('refuses closed → open with an empty or whitespace-only reason', () => {
      for (const reason of ['', ' ', '\n\t ']) {
        expect(checkStatusTransition('closed', 'open', 'STAFF', reason)).toEqual({
          ok: false,
          refusal: 'reason-required',
          message: 'A reason is required to re-open a closed ticket.',
        });
      }
    });

    it('records the reason, trimmed, when one is given', () => {
      expect(checkStatusTransition('closed', 'open', 'STAFF', '  Customer replied.  ')).toEqual({
        ok: true,
        reason: 'Customer replied.',
      });
    });
  });

  it('records a reason given on any other legal move', () => {
    expect(checkStatusTransition('open', 'in-progress', 'STAFF', ' Picking this up. ')).toEqual({
      ok: true,
      reason: 'Picking this up.',
    });
  });

  it('treats an empty reason on a move that does not need one as no reason', () => {
    expect(checkStatusTransition('resolved', 'closed', 'STAFF', '   ')).toEqual({
      ok: true,
      reason: null,
    });
  });
});
