# PlannerBuild Quote Generator

## Architecture and navigation

PlannerBuild remains one of the two application workspaces (Floorplan / PlannerBuild). Its native, keyboard-accessible view dropdown contains exactly **Gantt**, **Dashboard**, and **Quote Generator**. `plannerBuildView.ts` saves the view as a local UI preference; the legacy `TABLE` value resolves to Dashboard. All three views remain mounted while hidden, preserving Gantt zoom/filter state, Dashboard panels and quote edits. Local PlannerBuild remains available when account services fail; existing activity-tier limits are unchanged and do not limit quotation use.

The existing architecture inspected includes the activity/schedule model, Dashboard costs and trade summaries, deterministic room/wall/finish metrics, electrical BOM overrides/manual rows, classified plumbing and fittings, local IndexedDB repository, debounced autosave, portable project ZIP packages and existing print/export paths.

## Editable documents and sources

`quoteDocument.ts` defines validated version-1 QuoteDocuments, sections, items, parties, source snapshots, commercial text, export selections, statuses and stable IDs. Array order is authoritative for sections/items; redundant sort-order and financial totals are not persisted. A quote belongs to one project. Quote numbers are locally allocated without overwriting existing numbers; references remain editable. Copies and revisions receive new entity IDs. Revision numbering considers the project's existing revisions and preserves earlier documents.

`quoteSources.ts` reuses `calculatePlannerBuildMetrics` and `electricalBomRows`; it does not recalculate geometry from pixels or request estimated prices. Available sources are:

- Activities and their entered estimated/actual costs, phase, room and trade. These are explicitly presented as fixed-price lots, not inferred labour hours or days. Milestones, decisions and payment records are excluded.
- Room floor areas and net wall areas, named floor finishes and painted-wall surface area. Areas follow the existing one-decimal m² presentation convention. Paint litres are not invented when coverage/coats are unavailable.
- Electrical schedule counts, explicit order-quantity overrides, manual BOM rows and entered unit costs. Hidden schedule rows remain hidden.
- Classified plumbing counts and other-fitting/asset counts, excluding electrical/plumbing from the other-fitting totals.

Only categories with available records appear. Quantities or costs that are unavailable remain `null` / **Not set**, never a fabricated zero. Generated selling prices remain blank unless the user explicitly selects importing entered costs. Costs in another currency are not converted or imported. Obvious repeated source keys are skipped; activity/material overlap is disclosed for user review rather than falsely classified as a duplicate.

Generated items are ordinary editable quotation items. Manual lines have the same commercial behaviour. Users can add/delete/duplicate/reorder lines, drag between sections, and add/rename/reorder/delete sections. Customer/supplier/project details, logo, dates, status, descriptions, units, prices, tax, notes, scope, exclusions and terms are editable. Quote-only undo/redo does not change schedule history.

Each linked item stores the original source value. New project data is compared against that snapshot, not against the user's edited commercial quantity. Changes produce a review notice but never mutate the quote. Selective refresh updates quantity, unit and internal-cost snapshot only; selling price, edited description and notes remain untouched. **Keep quote** acknowledges the new source without changing commercial inputs; a removed source can be detached while retaining its quote line. Manual items are never refreshed.

Supplier identity can be saved as a reusable local business profile, separate from geometry/account requirements. Each quote retains its own identity snapshot and optional resized PNG/JPEG logo. No company information, legal terms or exclusions are invented.

## Money, VAT and discounts

`quoteCalculations.ts` is shared by editor, preview and PDF. Prices/costs use integer minor units; quantities, percentages and fixed discounts use decimal strings converted to BigInt rational arithmetic. Monetary rounding is half-up at the minor unit. JPY has no decimal minor units; the existing other currencies use two. GBP/EUR/USD and the application's remaining currency choices are supported. Currency changes do not perform FX conversion: nominal prices are retained with the new currency's rounding, and internal-cost snapshots are cleared for review.

Line subtotal is quantity × unit price, rounded once. A percentage or fixed quote discount is allocated proportionally using largest remainders with stable line-order tie breaking. Line VAT/tax is calculated on discounted net amounts and rounded per line. These amounts sum to the displayed grand total, with an optional per-rate tax breakdown. VAT is not applicable by default; per-line 0%, 5%, 20% or custom rates can be entered. This is calculation software, not tax advice.

Internal cost stays separate from selling price. Optional markup applies only to selected lines with a known internal unit cost. Neither costs nor source metadata are exported. Missing quantity/price, invalid discount and unsupported monetary ranges block export; optional customer/contact details do not.

## Preview and PDF

`quotePdf.ts` consumes only the current QuoteDocument, never raw project data. `pdf-lib` and locally bundled OFL Noto Sans font subsets provide an actual downloadable PDF, without cloud services or AI. The customer preview hides editing controls, internal costs and source metadata. Optional customer/project/descriptions/tax/scope/exclusions/terms/notes selections are applied consistently; core financial totals remain included.

The PDF has explicit white document styling independent of application theme. It includes supplied identity/logo, quote references/dates, customer/project details, current ordered sections and line values, line notes, totals, tax breakdown and commercial text. A4 pagination wraps descriptions, keeps ordinary rows together, continues exceptionally long descriptions, repeats quotation/table headers, keeps totals together and numbers pages. Unsupported font characters produce an explicit export error rather than silently replacing the customer's text; the bundled fonts cover Latin and Latin Extended, not every world script.

Visual PDF review checked a 45-item, eight-page sample. Every edited item, notes, scope, exclusions and payment terms was extracted successfully; its total matched £14,790.96 exactly. First, middle and final pages were rendered and inspected for clipping and layout. Internal cost/source metadata was absent.

## Persistence and compatibility

Quotes are an additive optional `quotes[]` property of schema-version-1 ProjectDocument, with their own independent document version. Old projects normalize to no quotes without user migration. Existing local autosave (900 ms debounce), IndexedDB backups and `.floorplan3d` save/load include all associated documents. Project duplication gives copied quotes the new project ownership and fresh quote IDs. Geometry, electrical layouts, assets and Gantt inputs remain unchanged by quote edits.

The cloud JSON validator now accepts only the known optional PlannerBuild/electrical/render-camera/quotation fields, validates quotation ownership/version/collection bounds and retains existing external-reference, nesting, text and 8 MB safeguards. No remote database migration is required for this JSON extension. Cloud subscription/storage availability is not needed for local quotation use; live cloud upload was not exercised in this task.

The feature follows appearance variables and Compact/Comfortable scaling. Narrow layouts stack party/details panels; item tables scroll horizontally rather than squeeze every column onto a phone. Customer documents stay light in Dark mode.

## Files and verification

New implementation: `frontend/components/QuoteGenerator.tsx`, its CSS module, `frontend/lib/quoteDocument.ts`, `quoteCalculations.ts`, `quoteSources.ts`, `quotePdf.ts`, `plannerBuildView.ts`, and `frontend/public/quote-fonts/` (including license).

Integration changes: planner client, PlannerBuildWorkspace, ProjectDocument, project repository, useLocalProject, frontend dependency manifest/lockfile and bounded backend project validator. Tests cover the quote domain and migrate existing PlannerBuild view assertions. A CSS-only test shim permits existing SSR component tests to run without a bundler.

Verification performed:

- 35 focused quote/PlannerBuild/project-persistence checks passed.
- 28 commercial API checks passed, including optional project fields, quote ownership/version and malformed quote rejection.
- TypeScript, frontend ESLint and the production static build passed.
- Browser production-build workflow passed: exact three dropdown options; Gantt/Dashboard state preservation; blank and generated quotes; manual edits; discounts/tax; lines/sections/reordering; preview/PDF download; revisions; source-change review/refresh/removal; autosave/reload; mobile navigation and Dark/Compact document preview.
- Wider frontend suite: 219/222 passed. Three unchanged existing expectations fail for flooring catalogue shape counts, old fixture-dimension colour CSS and missing currency in the preference-default assertion.
- Wider backend suite: 140/146 passed. Six unchanged catalogue expectations fail for historical category/item counts and representation versions.
- Backend Ruff reports one pre-existing 121-character Stripe error line; newly added validation code passes its rules. Unrelated user changes were preserved.

Release procedure: publish the master branch, deploy its static planner export to the existing Cloudflare Worker, and deploy the same committed backend snapshot to the Railway API. Verify the live PlannerBuild selector and quotation workflow on both public domains; no provider credentials or subscription configuration need to change.
