/** Explicit tab navigation starts at the new section; data updates retain the scroll position. */
export function scrollWorkbenchToStart(tab: HTMLElement) {
  tab.closest(".floating-toolbar-content")?.scrollTo({ top: 0 });
}
