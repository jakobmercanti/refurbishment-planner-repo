import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlannerBuildWorkspace } from "../components/PlannerBuildWorkspace.tsx";
import { addCalendarDays, calculatePlannerBuildMetrics, expectedDeliveryDate, getPlannerBuildScheduleSummary, getPlannerBuildWarnings, normalizePlannerBuild, wouldCreateDependencyCycle, type PlannerBuildActivity } from "../lib/plannerBuild.ts";
import { PLANNER_BUILD_ACTIVITY_LIBRARY, searchPlannerBuildActivityLibrary } from "../lib/plannerBuildActivityLibrary.ts";
import { formatPlannerBuildArea, formatPlannerBuildLength } from "../lib/plannerBuildPresentation.ts";
import { calculatePlannerBuildDashboard } from "../lib/plannerBuildDashboard.ts";
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
  colour: "#287FB8", category: "FIRST FIX", roomId: "room-test", progress: 25, type: "task",
  status: "in_progress", dependencyIds: [], sortOrder: 0, ...overrides,
});

test("PlannerBuild activities normalize date-only fields, colours, ranges and duplicate ids safely", () => {
  const normalized = normalizePlannerBuild({ activities: [
    activity({ colour: "not-a-colour", progress: 120, status: undefined }),
    activity({ name: "Duplicate id", sortOrder: 1 }),
    activity({ activityId: "bad-date", startDate: "2026-02-29" }),
    activity({ activityId: "bad-range", startDate: "2026-10-09", endDate: "2026-10-08" }),
  ] });
  assert.equal(normalized.activities.length, 2);
  assert.equal(normalized.activities[0].colour, "#287FB8");
  assert.equal(normalized.activities[0].progress, 100);
  assert.equal(normalized.activities[0].status, "completed");
  assert.deepEqual(normalized.activities[0].dependencyIds, []);
  assert.equal(normalized.activities[1].activityId, "activity-1-duplicate-2");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("legacy activities receive safe defaults and dangling, self and circular dependencies are removed", () => {
  const normalized = normalizePlannerBuild({ activities: [
    { ...activity({ activityId: "a", dependencyIds: ["b", "missing", "a"] }), type: undefined, status: undefined },
    { ...activity({ activityId: "b", dependencyIds: ["a"] }) },
  ] });
  assert.equal(normalized.activities[0].type, "task");
  assert.equal(normalized.activities[0].status, "in_progress");
  assert.deepEqual(normalized.activities.find((item) => item.activityId === "a")?.dependencyIds, ["b"]);
  assert.deepEqual(normalized.activities.find((item) => item.activityId === "b")?.dependencyIds, []);
});

test("activity library is application data with all renovation phases, search and filtering", () => {
  assert.ok(PLANNER_BUILD_ACTIVITY_LIBRARY.length > 100);
  assert.ok(searchPlannerBuildActivityLibrary("plaster").some((item) => item.name === "Plastering"));
  assert.ok(searchPlannerBuildActivityLibrary("", "PROCUREMENT").every((item) => item.category === "PROCUREMENT"));
  assert.ok(searchPlannerBuildActivityLibrary("xyz-no-match").length === 0);
  assert.ok(searchPlannerBuildActivityLibrary("watertight")[0].type === "milestone");
});

test("all schedule item types normalize and retain type-specific statuses and data", () => {
  const types = ["task", "milestone", "delivery", "inspection", "decision", "waiting", "appointment", "payment"] as const;
  const normalized = normalizePlannerBuild({ activities: types.map((type, index) => activity({
    activityId: "type-" + index, type, status: "not_started",
    ...(type === "delivery" ? { orderDate: "2026-10-01", leadTimeDays: 12, deliveryStatus: "delayed" as const, supplier: "Supplier A" } : {}),
    ...(type === "decision" ? { decisionDeadline: "2026-10-03" } : {}),
    ...(type === "inspection" ? { inspectionStatus: "failed" as const } : {}),
    ...(type === "payment" ? { paymentDueDate: "2026-10-08", amount: 1250.5, currency: "GBP", paymentStatus: "unpaid" as const } : {}),
  })) });
  assert.deepEqual(normalized.activities.map((item) => item.type), types);
  const delivery = normalized.activities.find((item) => item.type === "delivery")!;
  assert.equal(expectedDeliveryDate(delivery), "2026-10-13");
  assert.equal(delivery.deliveryStatus, "delayed");
  assert.equal(normalized.activities.find((item) => item.type === "inspection")?.inspectionStatus, "failed");
  assert.equal(normalized.activities.find((item) => item.type === "payment")?.amount, 1250.5);
});

test("dependency cycles are rejected and finish-to-start date conflicts are deterministic", () => {
  const first = activity({ activityId: "first", startDate: "2026-10-01", endDate: "2026-10-05" });
  const second = activity({ activityId: "second", startDate: "2026-10-05", endDate: "2026-10-08", dependencyIds: ["first"] });
  assert.equal(wouldCreateDependencyCycle([first, second], "first", "second"), true);
  assert.equal(wouldCreateDependencyCycle([first, second], "second", "first"), false);
  assert.match(getPlannerBuildWarnings([first, second], "2026-10-01")[0].message, /starts before prerequisite/);
  const delivery = activity({ activityId: "delivery", type: "delivery", startDate: "2026-10-10", endDate: "2026-10-10", orderDate: "2026-10-01", leadTimeDays: 14 });
  const install = activity({ activityId: "install", startDate: "2026-10-12", dependencyIds: ["delivery"] });
  assert.match(getPlannerBuildWarnings([delivery, install], "2026-10-01")[0].message, /expected to arrive/);
});

test("schedule dashboard summarizes upcoming events, pending work and counts", () => {
  const activities = [
    activity({ activityId: "milestone", name: "First fix complete", type: "milestone", startDate: "2026-10-06", endDate: "2026-10-06", status: "not_started", category: "FIRST FIX" }),
    activity({ activityId: "inspection", type: "inspection", inspectionStatus: "pending", status: "not_started" }),
    activity({ activityId: "blocked", status: "blocked", isBlocking: true, blockedReason: "Waiting on materials" }),
    activity({ activityId: "pay", type: "payment", paymentStatus: "unpaid", paymentDueDate: "2026-10-07" }),
  ];
  const summary = getPlannerBuildScheduleSummary(activities, "2026-10-05");
  assert.equal(summary.nextMilestone?.name, "First fix complete");
  assert.equal(summary.pendingInspections.length, 1);
  assert.equal(summary.blockedActivities.length, 1);
  assert.equal(summary.paymentsDue.length, 1);
  assert.equal(summary.countsByRoom[0].count, 4);
});

test("PlannerBuild cost summaries use the application currency for activities without one", () => {
  const dashboard = calculatePlannerBuildDashboard([activity({ estimatedCost: 125 })], "2026-10-01", "USD");
  assert.equal(dashboard.costs[0].currency, "USD");
  assert.equal(dashboard.costs[0].estimated, 125);
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

test("PlannerBuild display metrics use fixed readable metric units and one decimal place", () => {
  assert.equal(formatPlannerBuildArea(1_000_000), "1.0 m²");
  assert.equal(formatPlannerBuildArea(7_902_817), "7.9 m²");
  assert.equal(formatPlannerBuildArea(Number.NaN), "—");
  assert.equal(formatPlannerBuildLength(11_274), "11.3 m");
  assert.equal(formatPlannerBuildLength(Number.POSITIVE_INFINITY), "—");
});

test("PlannerBuild table view renders the live project dashboard and detail entry points", () => {
  const project = testProject();
  project.plannerBuild = { activities: [activity()] };
  const markup = renderToStaticMarkup(createElement(PlannerBuildWorkspace, {
    project, view: "TABLE", displayUnits: "METERS", onActivitiesChange: () => {},
  }));
  assert.match(markup, /Project dashboard/);
  assert.match(markup, /pb-primary-metric-grid/);
  assert.match(markup, /\d+\.\d m²/);
  assert.match(markup, /Estimated cost/);
  assert.match(markup, /Programme health/);
  assert.match(markup, /Activity register/);
  assert.match(markup, /Full quantity tables/);
  assert.match(markup, /Walls &amp; openings/);
  assert.match(markup, /Costs &amp; trade workload/);
  assert.match(markup, /Next milestone/);
  assert.match(markup, /25% average activity progress/);
  assert.doesNotMatch(markup, /£0\.00/);
  assert.match(markup, /L-shaped room/);
  assert.match(markup, /Required paint/);
  assert.match(markup, /Coverage \/ coats not set/);
});

test("PlannerBuild views format costs using the selected default currency", () => {
  const project = testProject();
  project.plannerBuild = { activities: [
    activity({ estimatedCost: 125 }),
    activity({ activityId: "explicit-currency", name: "Imported cost", actualCost: 80, currency: "EUR" }),
  ] };
  const markup = renderToStaticMarkup(createElement(PlannerBuildWorkspace, {
    project, view: "TABLE", displayUnits: "MM", defaultCurrency: "USD", onActivitiesChange: () => {},
  }));

  assert.ok(markup.includes(new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(125)));
  assert.ok(markup.includes(new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(80)));
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
  assert.match(scheduleMarkup, /25%/);
  assert.match(scheduleMarkup, /Dependencies/);
  assert.match(scheduleMarkup, /pb-gantt-dependencies/);
});

test("Gantt highlights a conflicting prerequisite warning and its matching dependency arrow", () => {
  const project = testProject();
  const prerequisite = activity({ activityId: "survey", name: "Site survey / measurements", startDate: "2026-09-27", endDate: "2026-10-15" });
  const dependent = activity({ activityId: "electrical", name: "Electrical fix", startDate: "2026-10-13", endDate: "2026-11-02", dependencyIds: ["survey"] });
  project.plannerBuild = { activities: [dependent, prerequisite] };
  const markup = renderToStaticMarkup(createElement(PlannerBuildWorkspace, {
    project, view: "GANTT", displayUnits: "MM", onActivitiesChange: () => {},
  }));

  assert.match(markup, /class="pb-schedule-warning warning"/);
  assert.match(markup, /pb-dependency-path conflict/);
  assert.match(markup, /marker-end="url\(#pb-dependency-arrow-conflict\)"/);
});
