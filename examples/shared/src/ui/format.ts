/** Formats a `Date` as `YYYY-MM-DD` in UTC, so the server render and the browser agree. */
export const formatDate = (date: Date): string => date.toISOString().slice(0, 10);
