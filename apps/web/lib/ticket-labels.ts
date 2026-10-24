import type { Priority, Status } from '@ticketdesk/shared';

// Exhaustive records: adding a Status or Priority fails compilation until it
// has a label. Both ticket pages read these, so there is one source per list.
export const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  'in-progress': 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
