import type { Priority, Status } from '@ticketdesk/shared';
import { PRIORITY_LABELS, STATUS_LABELS } from '../lib/ticket-labels';

// One rendering of a Status or Priority, shared by the list, the Ticket page
// and the raise form's radio labels, so the colour is the same everywhere.
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-status badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge badge-priority badge-${priority}`}>{PRIORITY_LABELS[priority]}</span>
  );
}
