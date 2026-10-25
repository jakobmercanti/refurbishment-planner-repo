/** Visible UI pixels, excluding the persistent application menu when scrolled. */
export function windowViewport() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? document.documentElement.clientWidth;
  const bottom = viewportTop + (viewport?.height ?? window.innerHeight);
  const menu = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect();
  const top = menu && menu.top < bottom && menu.bottom > viewportTop ? Math.min(bottom, Math.max(viewportTop, menu.bottom)) : viewportTop;
  return { left, top, width, height: Math.max(0, bottom - top) };
}
