import { windowHelpSteps, type WindowHelpStep } from "./windowHelp";
import { fieldDescription } from "./windowFieldHelp";

export const HELP_WINDOW_SELECTOR = ".floating-toolbar,dialog,[role='dialog'],[role='alertdialog'],.popup";
export const helpWindowFor = (element: Element) => element.closest(HELP_WINDOW_SELECTOR);

const excludedText = "input,select,textarea,button,output,[hidden],[aria-hidden='true']";
const excludedControl = ".window-header-actions,.floating-toolbar-titlebar,.window-help-button,.window-dialog-maximize,[aria-hidden='true'],[data-help-ignore]";
const helpControls = [
  "input:not([type='hidden'])", "select", "textarea", "[contenteditable='true']", "output", "th[scope='row']",
  "button", "summary", "a[href]", "[role='button']", "[role='tab']", "[role='switch']", "[role='checkbox']",
  "[role='radio']", "[role='slider']", "[role='combobox']", "[role='spinbutton']", "[role='textbox']", "[role='menuitem']", "[role='option']",
].join(",");
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
    .map(id => {
      const node = id ? control.ownerDocument.getElementById(id) : null;
      return node?.getAttribute("role") === "tooltip" ? "" : node?.textContent?.trim();
    }).filter(Boolean).join(" ");
}

function controlLabel(control: HTMLElement) {
  const labels = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
    || control instanceof HTMLOutputElement ? control.labels : null;
  const text = referenceText(control, "aria-labelledby") || control.getAttribute("aria-label")
    || Array.from(labels ?? [], label => helpLabelText(label.querySelector("span > strong") ?? label)).filter(Boolean).join(" ")
    || (control.matches("output") ? "" : helpLabelText(control)) || control.title || control.getAttribute("placeholder");
  return text?.replace(/\s+/g, " ").trim();
}

function defaultControlGuide(control: HTMLElement, label: string): string {
  if (control.matches("summary,[aria-expanded]:not([aria-haspopup])")) return `Open “${label}” to access its options. Close it to make more room in the window.`;
  if (control.matches("[role='tab']")) return `Switch to the “${label}” tab to see its fields, actions and section guides.`;
  if (control.matches("[role='option']")) return `Select “${label}” from this list.`;
  if (control.matches("a[href]")) return control.hasAttribute("download")
    ? `Download “${label}” from this window.` : `Follow “${label}” to open the linked resource.`;
  if (control.matches("[aria-pressed],[role='switch'],[role='checkbox']")) return `Turn “${label}” on or off.`;
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
  if (control.matches("button,[role='button'],[role='menuitem']")) return control.title || `Choose ${label} to run this action for the current selection.`;
  return `Enter ${label} for the current item. Use the value from the relevant project or source record.`;
}

export function controlHelp(control: HTMLElement, includeChoices = true): WindowHelpStep | undefined {
  const heading = controlLabel(control);
  if (!heading || !/\p{L}/u.test(heading)) return;
  const context = referenceText(control, "aria-describedby");
  const fallback = !includeChoices && control instanceof HTMLSelectElement
    ? `Choose ${heading} from the available options.`
    : defaultControlGuide(control, heading);
  const guide = control.dataset.fieldHelp || fieldDescription(heading) || control.title || context || fallback;
  return { heading, text: context && !guide.includes(context) ? `${guide} ${context}` : guide };
}

/** Read controls even when a native disclosure is closed. Never include input values. */
export function windowFieldHelp(scope: Element): WindowHelpStep[] {
  const owner = helpWindowFor(scope);
  const fields = new Map<string, WindowHelpStep>();
  for (const control of scope.querySelectorAll<HTMLElement>(helpControls)) {
    if (helpWindowFor(control) !== owner || control.closest(excludedControl)) continue;
    if (control.matches("summary") && control.parentElement === scope) continue;
    if (control.closest(".window-help-disclosure-header")?.parentElement === scope) continue;
    const guide = controlHelp(control);
    if (guide) fields.set(`${guide.heading}: ${guide.text}`, guide);
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
    if (helpWindowFor(topic) !== owner) continue;
    const name = topic.dataset.windowHelpTopic;
    if (!name) continue;
    groups.push(parseHelpSteps(topic.dataset.windowHelpSteps) ?? windowHelpSteps(name));
  }
  const guide = mergeHelpSteps(...groups);
  const authored = new Set((steps ?? []).map(step => step.heading.toLowerCase()));
  const known = new Set(guide.map(step => JSON.stringify([step.heading, step.text])));
  return guide.concat(scope ? windowFieldHelp(scope).filter(step => !authored.has(step.heading.toLowerCase()) && !known.has(JSON.stringify([step.heading, step.text]))) : []);
}
