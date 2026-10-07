export const PLANNER_BUILD_DEMO_MAX_ACTIVITIES = 5;

export function canAddPlannerActivityInDemo(demoMode: boolean, activityCount: number): boolean {
  return !demoMode || activityCount < PLANNER_BUILD_DEMO_MAX_ACTIVITIES;
}
