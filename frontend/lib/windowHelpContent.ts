import { windowHelpSteps, type WindowHelpStep } from "./windowHelp";

export const HELP_WINDOW_SELECTOR = ".floating-toolbar,dialog,[role='dialog'],[role='alertdialog'],.popup";
export const helpWindowFor = (element: Element) => element.closest(HELP_WINDOW_SELECTOR);

/** DOM metadata is untrusted at runtime; malformed topics must not break the main guide. */
export function parseHelpSteps(value: string | undefined): WindowHelpStep[] | null {
  try {
    const parsed: unknown = JSON.parse(value ?? "");
    if (!Array.isArray(parsed) || !parsed.every(step => step && typeof step.heading === "string" && typeof step.text === "string" &&
      (step.links === undefined || Array.isArray(step.links) && step.links.every((link: unknown) => link && typeof link === "object" && "label" in link && typeof link.label === "string" && "url" in link && typeof link.url === "string")))) return null;
    return parsed;
  } catch { return null; }
}

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
  const groups = [steps ?? windowHelpSteps(title)], owner = scope ? helpWindowFor(scope) : null;
  if (scope) for (const topic of scope.querySelectorAll<HTMLElement>("[data-window-help-topic]")) {
    if (owner && helpWindowFor(topic) !== owner) continue;
    const name = topic.dataset.windowHelpTopic;
    if (!name) continue;
    groups.push(parseHelpSteps(topic.dataset.windowHelpSteps) ?? windowHelpSteps(name));
  }
  return mergeHelpSteps(...groups);
}
