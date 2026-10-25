import { plansPage } from "../../../deployment/plans-page.mjs";

// Production's Worker owns this URL. This public fallback also makes it work
// in next dev and an exported local preview; it never embeds account data.
export const dynamic = "force-static";

export function GET() {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return new Response(plansPage(null).replaceAll("/planner/", `${base}/`), {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}
