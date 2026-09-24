# FreeFloorplan3D public planner

Canonical URL: https://www.freefloorplan3d.com/planner/
Legacy /planner-test and /planner-test/* routes permanently redirect to /planner.
The editor is public and indexable at its canonical URL.

## Hosting

Cloudflare account: e7b15d4071cac7e990eee39776523c4f
Zone: b70e9c7623bf478b6d7d7ef776d83936
Planner Worker: freefloorplan3d-planner-test (existing internal name retained)
Public routes: www.freefloorplan3d.com/planner and /planner/*
Legacy redirect routes: www.freefloorplan3d.com/planner-test and /planner-test/*
Backend: https://freefloorplan3d-api-production.up.railway.app
Railway project: 45ec36d9-5b66-437c-a1b3-d85bdfb5a97f
Environment: e1e7e064-a93e-4c5d-8f96-fa21dcc00e2b
Service: freefloorplan3d-api (31789d11-d7e6-471c-81bf-665edfb634c2)
Source: jakobmercanti/refurbishment-planner-repo, master, root Dockerfile.

The marketing website has its own repository:
https://github.com/jakobmercanti/freefloorplan3d-website
Its local checkout is freefloorplan3d-website/ and its Worker is freefloorplan3d.
Do not deploy the historical freefloorplan3d/ or landing/ folders over that site.

## Publishing

Build from frontend/ with:
- PLANNER_STATIC_EXPORT=true
- NEXT_PUBLIC_BASE_PATH=/planner
- NEXT_PUBLIC_API_URL=/planner/engineering-api
- NEXT_PUBLIC_ENABLE_PROGRAMMER_TOOLS=false

Run pnpm build, then from the repository root:
pnpm dlx wrangler deploy --config deployment/wrangler.jsonc

The browser no longer contains a PostHog project token or sends to PostHog directly.
The Railway backend uses POSTHOG_PROJECT_TOKEN, set in the deployment Dockerfile
to the existing public project token. This is not an administrative API credential.
Do not expose owner catalogue-management tools or private database contents.
The public proxy only permits the configured read and calculation endpoints.
Public CAD, server project storage and catalogue mutations remain blocked.

## Public launch, 22 September 2026

The /planner URL replaces the former preview URL. Public metadata and canonical
links now describe the free 2D/3D editor. Existing same-origin browser projects
remain accessible after the path move. My 3D models is hidden from the menu;
stored projects and assets are preserved. Squared walls remains enabled by default.
Compact devices display one selected tool panel at a time.
Project archives can be saved/opened on mobile; native sharing depends on browser support.

The marketing site now has live planner CTAs, updated guides, sitemap and metadata,
structured data, a social image, responsive styling, and current privacy/cookie notices.

## Privacy-minimal aggregate analytics

PostHog US project 621378 receives only floorplan_generated once for the first
validated, locally saved plan in a project, and floorplan_downloaded after a
download/export dispatch, with a fixed format label. No visitor or page-view
count is collected. The browser sends only this allowlisted payload to the
same-origin /planner/engineering-api/analytics/event endpoint. The Cloudflare
Worker relays only a small JSON body to Railway, stripping browser headers.
An ephemeral Cloudflare rate-limit bucket prevents routine event flooding;
its IP key is not placed in the event or sent to PostHog.
The backend validates the event and forwards it server-side with one constant
distinct_id, person-profile processing disabled and IP geolocation disabled.
No browser PostHog SDK, autocapture, replay or browser-to-PostHog request is used.
Cloudflare and Railway still see technical request data. Counts are best-effort
and cannot prove a file was saved to disk.

Action counts are on by default; a user can object from the website privacy
page or planner settings. Both surfaces respect ffp3d_analytics_opt_out=true
and the legacy freefloorplan3d:analytics=no setting. If localStorage is
unavailable, sending fails closed. Neither choice affects planner functionality.

Before claiming regulatory compliance, the operator must verify the PostHog
project has IP capture, autocapture, replay, heatmaps, person profiles and
automatic page views disabled, review retention and international-transfer
terms, and obtain advice for jurisdictions outside the UK. These account
settings and arrangements have not been independently verified by code changes.

## Validation

Historical launch validation is described above. The September 23 aggregate
analytics change was requested without running tests.
