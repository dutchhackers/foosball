/**
 * Gets the ISO week number for a given Date object.
 * ISO 8601 week definition: Week starts on Monday. Week 1 is the week containing the first Thursday of the year.
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number (adjust Sunday=7)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return weekNo;
}

/**
 * Generates daily (YYYY-MM-DD) and weekly (YYYY-WXX) timeframe IDs for a given timestamp.
 * Uses UTC to ensure consistency across timezones.
 * @param timestamp Optional ISO timestamp string. Defaults to now.
 * @returns Object containing daily and weekly IDs.
 */
export function getTimePeriodIds(timestamp?: string): { daily: string; weekly: string } {
  const date = timestamp ? new Date(timestamp) : new Date();

  // Daily ID: YYYY-MM-DD (in UTC)
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  const dailyId = `${year}-${month}-${day}`;

  // Weekly ID: YYYY-WXX (ISO 8601 week number)
  const weekNumber = getISOWeekNumber(date);
  const weeklyId = `${year}-W${weekNumber.toString().padStart(2, '0')}`; // Ensure week number is two digits

  return { daily: dailyId, weekly: weeklyId };
}
