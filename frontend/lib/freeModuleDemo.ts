export const PLANNER_BUILD_DEMO_MAX_ACTIVITIES = 5;
export const FREE_DEMO_MAX_ELECTRICAL_CONNECTIONS = 5;
export const FREE_DEMO_MAX_ELECTRICAL_CIRCUITS = 1;

export function canAddPlannerActivityInDemo(demoMode: boolean, activityCount: number): boolean {
  return !demoMode || activityCount < PLANNER_BUILD_DEMO_MAX_ACTIVITIES;
}

export function canAddElectricalCircuitInDemo(demoMode: boolean, circuitCount: number): boolean {
  return !demoMode || circuitCount < FREE_DEMO_MAX_ELECTRICAL_CIRCUITS;
}

export function canAddElectricalConnectionInDemo(
  demoMode: boolean,
  connectionCount: number,
  circuitCount: number,
  activeCircuitId: string | null,
): boolean {
  return !demoMode || (
    connectionCount < FREE_DEMO_MAX_ELECTRICAL_CONNECTIONS
    && circuitCount === FREE_DEMO_MAX_ELECTRICAL_CIRCUITS
    && activeCircuitId !== null
  );
}
