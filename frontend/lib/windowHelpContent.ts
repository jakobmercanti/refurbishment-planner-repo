import { windowHelpSteps, type WindowHelpStep } from "./windowHelp";
import { fieldDescription } from "./windowFieldHelp";

export const HELP_WINDOW_SELECTOR = ".floating-toolbar,dialog,[role='dialog'],[role='alertdialog'],.popup";
export const helpWindowFor = (element: Element) => element.closest(HELP_WINDOW_SELECTOR);

const excludedText = "input,select,textarea,button,output,[hidden],[aria-hidden='true']";
function textOf(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node instanceof Element && node.matches(excludedText)) return "";
  return Array.from(node.childNodes, textOf).join("");
}
export function helpLabelText(node: Node): string {
  return Array.from(node.childNodes, textOf).join(" ").replace(/\s+/g, " ").trim();
}

function referenceText(control: Element, attribute: "aria-labelledby" | "aria-describedby") {
  return (control.getAttribute(attribute) ?? "").split(/\s+/)
    .map(id => id && control.ownerDocument.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ");
}

function controlLabel(control: HTMLElement) {
  const labels = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
    || control instanceof HTMLOutputElement ? control.labels : null;
  const text = referenceText(control, "aria-labelledby") || control.getAttribute("aria-label")
    || Array.from(labels ?? [], label => helpLabelText(label.querySelector("span > strong") ?? label)).filter(Boolean).join(" ")
    || helpLabelText(control) || control.title || control.getAttribute("placeholder");
  return text?.replace(/\s+/g, " ").trim();
}

function controlGuide(control: HTMLElement, label: string): string {
  const supplied = control.getAttribute("data-field-help") || referenceText(control, "aria-describedby");
  const authored = supplied || fieldDescription(label);
  if (authored) return authored;
  if (control instanceof HTMLSelectElement) {
    const options = Array.from(control.options).filter(option => !option.disabled);
    const choices = options.length <= 6 && options.every(option => option.label.length <= 45) ? options.map(option => option.label).join(", ") : "";
    return choices ? `Select ${label} from the available choices. The current list offers ${choices}.` : `Choose ${label} from the available entries for the current selection.`;
  }
  if (control instanceof HTMLInputElement) {
    if (control.type === "checkbox") return `Turn “${label}” on or off for the current settings.`;
    if (control.type === "radio") return `Select “${label}” as the active option in this group.`;
    if (control.type === "file") return `Choose a file for ${label}${control.accept ? ` (accepted formats: ${control.accept})` : ""}.`;
    if (control.type === "number" || control.type === "range" || ["decimal", "numeric"].includes(control.inputMode)) {
      const bounds = [control.min && `minimum ${control.min}`, control.max && `maximum ${control.max}`].filter(Boolean);
      return `Enter ${label} as a number in the displayed units, using the applicable measurement or design input${bounds.length ? ` (${bounds.join(", ")})` : ""}.`;
    }
    if (control.type === "date" || control.type === "datetime-local") return `Enter the date for ${label} from the relevant project schedule or record.`;
    if (control.type === "color") return `Choose the colour for ${label} in the colour picker.`;
    if (control.readOnly) return `Read ${label} for the current selection. This value is read-only here.`;
  }
  if (control.matches("output, th[scope='row']")) return `Read ${label} in the results for the current inputs and units.`;
  if (control.matches("button")) return control.title || `Choose ${label} to run this action for the current selection.`;
  return `Enter ${label} for the current item. Use the value from the relevant project or source record.`;
}

/** Read controls even when a native disclosure is closed. Never include input values. */
export function windowFieldHelp(scope: Element): WindowHelpStep[] {
  const owner = helpWindowFor(scope);
  const fields = new Map<string, WindowHelpStep>();
  for (const control of scope.querySelectorAll<HTMLElement>("input:not([type='hidden']),select,textarea,[contenteditable='true'],output,th[scope='row'],details button")) {
    if ((owner && helpWindowFor(control) !== owner) || control.closest("summary,.window-header-actions,.floating-toolbar-titlebar,.cfx-row-menu,[aria-hidden='true'],[data-help-ignore]")) continue;
    const label = controlLabel(control);
    if (!label || !/\p{L}/u.test(label)) continue;
    const text = controlGuide(control, label);
    fields.set(`${label}: ${text}`, { heading: label, text });
  }
  return [...fields.values()];
}

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
  const guide = mergeHelpSteps(...groups);
  const known = new Set(guide.map(step => JSON.stringify([step.heading, step.text])));
  return guide.concat(scope ? windowFieldHelp(scope).filter(step => !known.has(JSON.stringify([step.heading, step.text]))) : []);
}
