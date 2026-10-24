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

/** A label record as the options of a `<select>` or a group of checkboxes. */
function optionsOf<T extends string>(
  labels: Record<T, string>,
): Array<{ value: T; label: string }> {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

// Derived once, in declaration order, so the list's filters and the raise form
// offer the same values under the same labels.
export const STATUS_OPTIONS = optionsOf(STATUS_LABELS);
export const PRIORITY_OPTIONS = optionsOf(PRIORITY_LABELS);
