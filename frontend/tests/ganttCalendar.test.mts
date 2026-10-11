import test from "node:test";
import assert from "node:assert/strict";
import { calendarWeeks, isoWeek, visibleCalendarDays } from "../lib/ganttCalendar.ts";

test("calendar fills the viewport with whole days without shrinking long schedules", () => {
  assert.equal(visibleCalendarDays("2026-10-09", "2026-11-14", 1740, 18), 97);
  assert.equal(visibleCalendarDays("2026-10-09", "2026-11-14", 1740, 42), 42);
  assert.equal(visibleCalendarDays("2026-10-09", "2026-11-14", 1740, 5), 348);
  assert.equal(visibleCalendarDays("2026-01-01", "2026-12-31", 560, 18), 365);
});

test("ISO weeks handle year boundaries, partial weeks and leap days", () => {
  assert.deepEqual(isoWeek("2021-01-01"), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek("2021-01-04"), { year: 2021, week: 1 });
  assert.deepEqual(isoWeek("2024-02-29"), { year: 2024, week: 9 });
  const weeks = calendarWeeks("2020-12-30", 10);
  assert.deepEqual(weeks, [{ offset: 0, days: 5, year: 2020, week: 53 }, { offset: 5, days: 5, year: 2021, week: 1 }]);
  assert.equal(calendarWeeks("2026-10-09", 97).reduce((sum, week) => sum + week.days, 0), 97);
});
