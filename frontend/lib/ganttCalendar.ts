import { addCalendarDays, calendarDaysBetween } from "./plannerBuild";

export function visibleCalendarDays(start: string, end: string, availableWidth: number, dayWidth: number): number {
  return Math.max(1, calendarDaysBetween(start, end) + 1, Math.ceil(Math.max(560, availableWidth) / dayWidth));
}

/** ISO weeks start on Monday; week one contains January 4. All arithmetic is UTC. */
export function isoWeek(dateKey: string): { year: number; week: number } {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return { year, week };
}

export function calendarWeeks(start: string, totalDays: number) {
  const weeks: Array<{ offset: number; days: number; year: number; week: number }> = [];
  for (let offset = 0; offset < totalDays; offset++) {
    const date = addCalendarDays(start, offset), value = isoWeek(date);
    const last = weeks.at(-1);
    if (last && last.week === value.week && last.year === value.year) last.days++;
    else weeks.push({ offset, days: 1, ...value });
  }
  return weeks;
}
