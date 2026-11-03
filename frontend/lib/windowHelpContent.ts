import { windowHelpSteps, type WindowHelpStep } from "./windowHelp";

export function mergeHelpSteps(...groups: WindowHelpStep[][]): WindowHelpStep[] {
  const seen = new Set<string>();
  return groups.flat().filter(step => {
    const key = JSON.stringify([step.text, step.links ?? []]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/** Hidden topic markers retain guidance consolidated into an enclosing section/window. */
export function collectedHelp(scope: Element | null, title: string, steps?: WindowHelpStep[]) {
  const groups = [steps ?? windowHelpSteps(title)];
  if (scope) for (const topic of scope.querySelectorAll<HTMLElement>("[data-window-help-topic]")) {
    const name = topic.dataset.windowHelpTopic;
    if (!name) continue;
    try { groups.push(topic.dataset.windowHelpSteps ? JSON.parse(topic.dataset.windowHelpSteps) as WindowHelpStep[] : windowHelpSteps(name)); }
    catch { groups.push(windowHelpSteps(name)); }
  }
  return mergeHelpSteps(...groups);
}
