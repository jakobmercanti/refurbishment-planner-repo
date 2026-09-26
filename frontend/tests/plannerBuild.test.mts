import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlannerBuildWorkspace } from "../components/PlannerBuildWorkspace.tsx";
import { addCalendarDays, calculatePlannerBuildMetrics, normalizePlannerBuild, type PlannerBuildActivity } from "../lib/plannerBuild.ts";
import { newProject, parseProject, type ProjectDocument } from "../lib/projectDocument.ts";
import type { Room } from "../lib/types.ts";
import starterDemo from "../lib/starterDemo.json";

const sourceRoom = (starterDemo as unknown as { room: Room }).room;
function testRoom(): Room { return { ...sourceRoom, id: "room-test", name: "L-shaped room" }; }
function testProject(room = testRoom()): ProjectDocument {
  const project = newProject();
  project.rooms = [room];
  return project;
}
const activity = (overrides: Partial<PlannerBuildActivity> = {}): PlannerBuildActivity => ({
  activityId: "activity-1", name: "Electrical first fix", startDate: "2026-10-05", endDate: "2026-10-08",
  colour: "#287FB8", category: "Electrical", roomId: "room-test", progress: 25, sortOrder: 0, ...overrides,
});

test("PlannerBuild activities normalize date-only fields, colours, ranges and duplicate ids safely", () => {
  const normalized = normalizePlannerBuild({ activities: [
    activity({ colour: "not-a-colour", progress: 120 }),
    activity({ name: "Duplicate id", sortOrder: 1 }),
    activity({ activityId: "bad-date", startDate: "2026-02-29" }),
    activity({ activityId: "bad-range", startDate: "2026-10-09", endDate: "2026-10-08" }),
  ] });
  assert.equal(normalized.activities.length, 2);
  assert.equal(normalized.activities[0].colour, "#287FB8");
  assert.equal(normalized.activities[0].progress, 100);
  assert.equal(normalized.activities[1].activityId, "activity-1-duplicate-2");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("legacy project files open with an empty PlannerBuild schedule", () => {
  const legacy = newProject();
  delete (legacy as unknown as { plannerBuild?: unknown }).plannerBuild;
  const loaded = parseProject(legacy);
  assert.deepEqual(loaded.plannerBuild, { activities: [] });

  const scheduled = newProject();
  scheduled.plannerBuild = { activities: [activity({ notes: "Coordinate with the electrician.", roomId: "room-removed" })] };
  const roundtrip = parseProject(JSON.parse(JSON.stringify(scheduled)));
  assert.deepEqual(roundtrip.plannerBuild.activities, scheduled.plannerBuild.activities);
  assert.equal(roundtrip.plannerBuild.activities[0].roomId, "room-removed");
});

test("metrics calculate irregular room area, true perimeter and known opening deductions in millimetres", () => {
  const metrics = calculatePlannerBuildMetrics(testProject());
  assert.equal(metrics.summary.roomCount, 1);
  assert.equal(metrics.summary.totalFloorAreaMm2, 7_960_000);
  assert.equal(metrics.rooms[0].perimeterMm, 12_000);
  assert.equal(metrics.summary.uniqueWallCount, 6);
  assert.equal(metrics.summary.totalWallLengthMm, 12_000);
  assert.equal(metrics.summary.grossWallAreaMm2, 28_800_000);
  assert.equal(metrics.summary.netWallAreaMm2, 26_268_000);
  assert.equal(metrics.openings.doors, 1);
  assert.equal(metrics.openings.windows, 1);
  assert.equal(metrics.openings.doorAreaMm2, 1_632_000);
  assert.equal(metrics.openings.windowAreaMm2, 900_000);
});

test("electrical quantities use structured asset metadata and plumbing does not infer unknown items", () => {
  const room = testRoom();
  const existing = room.obstacles[0];
  const electrical = { ...existing, id: "socket-1", fixture_kind: "OTHER", representation_key: "electrical-wall-socket", subcategory: "Socket", center: { x: 700, y: 700 } };
  const metrics = calculatePlannerBuildMetrics(testProject({ ...room, obstacles: [electrical] }));
  assert.equal(metrics.summary.electricalCount, 1);
  assert.equal(metrics.rooms[0].electrical, 1);
  assert.equal(metrics.summary.plumbingCount, 0);

  const unknownFixture = { ...existing, id: "unclassified-1", fixture_kind: "OTHER", representation_key: "custom-asset" };
  const unknown = calculatePlannerBuildMetrics(testProject({ ...room, obstacles: [unknownFixture] }));
  assert.equal(unknown.summary.plumbingCount, null);
  assert.equal(unknown.rooms[0].plumbing, null);
});

test("missing wall height and paint coverage stay unknown rather than becoming false zeroes", () => {
  const room = testRoom();
  const missingHeight = { ...room, wall_height: { ...room.wall_height, value: 0 }, finishes: { ...room.finishes, wall_colors: { "wall-001": "#DDEEFF" } } } as Room;
  const metrics = calculatePlannerBuildMetrics(testProject(missingHeight));
  assert.equal(metrics.rooms[0].grossWallAreaMm2, null);
  assert.equal(metrics.summary.grossWallAreaMm2, null);
  assert.equal(metrics.paintedWallAreaMm2, null);
});

test("PlannerBuild quantities view renders the derived project summary and schedule", () => {
  const project = testProject();
  project.plannerBuild = { activities: [activity()] };
  const markup = renderToStaticMarkup(createElement(PlannerBuildWorkspace, {
    project, view: "TABLE", displayUnits: "METERS", onActivitiesChange: () => {},
  }));
  assert.match(markup, /Project summary/);
  assert.match(markup, /L-shaped room/);
  assert.match(markup, /Electrical first fix/);
  assert.match(markup, /Basin/);
  assert.match(markup, /Paint litres are not estimated/);
});

test("Gantt view has a useful empty state and renders saved activity bars", () => {
  const project = testProject();
  const emptyMarkup = renderToStaticMarkup(createElement(PlannerBuildWorkspace, {
    project, view: "GANTT", displayUnits: "MM", onActivitiesChange: () => {},
  }));
  assert.match(emptyMarkup, /No activities yet/);
  assert.match(emptyMarkup, /Add first activity/);

  project.plannerBuild = { activities: [activity()] };
  const scheduleMarkup = renderToStaticMarkup(createElement(PlannerBuildWorkspace, {
    project, view: "GANTT", displayUnits: "MM", onActivitiesChange: () => {},
  }));
  assert.match(scheduleMarkup, /Project activity schedule/);
  assert.match(scheduleMarkup, /Electrical first fix/);
  assert.match(scheduleMarkup, /25% complete/);
});
