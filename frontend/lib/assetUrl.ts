export function assetUrl(path: string | undefined | null): string {
  if (!path) return "";
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (path.startsWith("/fixture-") || path === "/planner-build-icon.png") return `${base}${path}`;
  if (path.startsWith("/catalog/")) return `${process.env.NEXT_PUBLIC_API_URL ?? "/engineering-api"}${path}`;
  return path;
}
