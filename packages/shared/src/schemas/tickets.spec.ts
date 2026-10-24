import { describe, expect, it } from 'vitest';
import { ticketListQueryString } from './tickets';

describe('ticketListQueryString', () => {
  it('writes every selected value, comma-separated, under its own parameter', () => {
    expect(
      ticketListQueryString({
        status: ['open', 'closed'],
        priority: ['high'],
        assigneeId: ['staff-1', 'staff-2'],
      }),
    ).toBe('status=open%2Cclosed&priority=high&assigneeId=staff-1%2Cstaff-2');
  });

  it('omits a filter with nothing selected', () => {
    expect(ticketListQueryString({ status: [], priority: [], assigneeId: [] })).toBe('');
  });
});
