# PlannerBuild landing page

Public marketing site for [PlannerBuild](https://plannerbuild.com), hosted on Cloudflare Pages.

## Local preview

Serve this directory with any static web server, for example:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Deployment

The production Cloudflare Pages project is named `plannerbuild`.

```powershell
pnpm dlx wrangler pages deploy . --project-name plannerbuild --branch main
```

The contact form prepares an email to `info@plannerbuild.com`; Cloudflare Email Routing forwards that address to the PlannerBuild team inbox.
