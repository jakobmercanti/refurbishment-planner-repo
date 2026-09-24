# FreeFloorplan3D public website

Production: https://www.freefloorplan3d.com/

This standalone marketing site is separate from the Renovation Fit editor and
the existing PlannerBuild landing page. Node.js 22+ builds it without installing
any packages. No visitor accounts, forms, analytics or storage are enabled.

## Development and checks

Run `node build.mjs`, `node --test tests.mjs`, then `node server.mjs` from this
directory. The preview is at http://localhost:4175. The build produces public
HTML/assets in `dist/` and a Cloudflare module in `worker.generated.mjs`.

## Hosting

Cloudflare account: e7b15d4071cac7e990eee39776523c4f
Worker: freefloorplan3d
Zone: b70e9c7623bf478b6d7d7ef776d83936
Custom domains: www.freefloorplan3d.com and freefloorplan3d.com.
The apex and HTTP permanently redirect to HTTPS www. Unknown URLs return 404.

Deploy the generated module through the Cloudflare connection as `main_module`
with compatibility date 2026-09-05, or use Wrangler with `wrangler.jsonc`.
The Worker bundles the small static site; there are no runtime bindings or
secrets. Asset responses use ETags and one-hour caching. HTML revalidates.

## Plugging in the future editor

The public entry route is `/planner/`. Replace the `#floorplan-app` coming-soon
content in `site.mjs` with the application mount when the software is ready.
If the editor requires its own bundle/server, preserve `/planner/` and mount
or route its deployment there. The current static Worker does not implement
editor API routes, authentication, geometry, saves or exports.

Keep all authoritative dimensions and geometry in millimetres. Illustrative
website graphics must never become authoritative fit or uncertainty data.

At launch: confirm actual supported features and export formats; update the
coming-soon messages, privacy notice, primary calls to action and metadata;
review the content-security policy for the actual editor requirements; verify
2D/3D creation and free downloads end-to-end. Preserve the guide URLs.

## Search foundation

Each page ships complete HTML, a distinct title/description, canonical URL,
semantic headings and crawlable links. `/sitemap.xml` lists the seven indexable
pages; `/robots.txt` references it. Structured data describes the organisation,
website and pages, without fictional reviews, usage claims or active software
offers. Text accurately states that the product is in development.

To monitor indexing, verify a domain property in Google Search Console and
submit https://www.freefloorplan3d.com/sitemap.xml. No Search Console access or
verification token was provided in this task. Rankings and indexing are not
guaranteed. Add new guides only when they provide distinct, useful information.

## Artwork

The user-provided PlannerBuildIcon.png is used unchanged apart from resizing
and compression for `public/assets/brand-icon.png`, the 48/192 px favicons and
180 px touch icon. The original file remains in its supplied location.

`public/assets/home-3d.webp` was generated with the built-in image generation
tool, then compressed. Prompt: polished architectural 3D dollhouse cutaway of
a single-storey two-bedroom apartment, roof removed, pale cool-blue background,
white walls, oak floors, blue sofa, kitchen island, dining area, two bedrooms,
bathroom and small plants; soft daylight; entire home visible; landscape 3:2;
no text, labels, UI or watermark. It is labelled as concept artwork, not
software output. SVG floorplan diagrams are illustrative and not to scale.
