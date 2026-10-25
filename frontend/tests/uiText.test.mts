import test from "node:test";
import assert from "node:assert/strict";
import { formatUiCount } from "../lib/uiText";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlannerBuildDashboard } from "../components/PlannerBuildDashboard";
import { calculatePlannerBuildMetrics } from "../lib/plannerBuild";
import { newProject } from "../lib/projectDocument";

test("visible counts distinguish singular, plural and unknown without changing values", () => {
  assert.equal(formatUiCount(0, "room"), "0 rooms");
  assert.equal(formatUiCount(1, "room"), "1 room");
  assert.equal(formatUiCount(2, "room"), "2 rooms");
  assert.equal(formatUiCount(1200, "activity", "activities"), "1,200 activities");
  assert.equal(formatUiCount(null, "asset"), "Not set");
  assert.equal(formatUiCount(undefined, "asset"), "Not set");
  assert.equal(formatUiCount(Number.NaN, "asset"), "Not set");
  assert.equal(formatUiCount(null, "classified asset", "classified assets", "Not classified"), "Not classified");
});

test("a populated single-activity dashboard uses singular, user-facing cost labels", () => {
  const project=newProject();
  const activity={activityId:"audit-activity",name:"Measure room",startDate:"2026-10-19",endDate:"2026-10-19",colour:"#287fb8",roomId:null,progress:0,type:"task" as const,status:"not_started" as const,dependencyIds:[],sortOrder:0,estimatedCost:100,actualCost:25,currency:"GBP"};
  project.plannerBuild={activities:[activity]};
  const markup=renderToStaticMarkup(createElement(PlannerBuildDashboard,{activities:[activity],metrics:calculatePlannerBuildMetrics(project),today:"2026-10-19",onEdit:()=>{},onOpen:()=>{},onAddDelivery:()=>{}}));
  const text=markup.replace(/<[^>]+>/g,"");
  assert.match(text,/1 estimate · 1 recorded cost/);
  assert.match(text,/1 of 1 activity estimated/);
  assert.match(text,/1 work activity/);
  assert.doesNotMatch(text,/1 estimates|1 actuals|1 work activities/);
});
