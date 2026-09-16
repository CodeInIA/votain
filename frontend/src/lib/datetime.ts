/**
 * How a moment is written out, in the one place that decides it.
 *
 * Two screens needed the same thing within a day of each other: the gas
 * history, where several movements can land on one date and only the minute
 * tells them apart, and the schedule timeline, where an enrolment window that
 * closes "on the 17th" tells a voter nothing about whether they have until
 * breakfast or until midnight.
 */

/** Date and time, to the minute, in the reader's own locale and zone. */
export function formatDateTime(date: Date): string {
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
