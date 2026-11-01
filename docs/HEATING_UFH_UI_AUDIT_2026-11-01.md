# Heating, UFH and shared UI audit — 1 November 2026

Scope: the fourteen Heating/UFH screenshots, the preceding fitting/scenario list,
and the preceding window/export/chevron/socket/help list. Changes are confined to
frontend source, regression tests and these audit notes. Unrelated website work
is excluded from the commit.

## Reported paths

1. Building assumptions now edits resolved surface U-values using the same
   Energy assignments and active construction scenario as Insulation. It does
   not edit a misleading second set of building fallbacks. Layer-derived values
   appear automatically; entering a direct U explicitly replaces the selected
   surface's layer assignment in that scenario.
2. Heating's heat-loss display reuses `EnergyLayoutOverlay`, including wall U/W
   labels and floor/roof cards. It is read-only in Heating and uses the same
   resolved Energy document. The old orange wall highlight is suppressed there.
3. Room setup is collapsible. Its four advanced/display actions form two equal
   columns and two rows. Heating-method guidance is in the target-temperature
   help; its redundant automatic help button is suppressed.
4. Radiator details expand from the principal model/output row. The instruction
   line and separate Output details disclosure were removed.
5. The three pipe actions share equal grid columns.
6. Draft and saved pipes use one route editor: drag corners or segments,
   double-click a segment to insert a point, right-click a corner to delete it.
   Square routing survives edits/deletion. Connected endpoints stay anchored;
   locked pipes cannot be changed. Pointer cancellation discards the preview.
7. New room UFH starts from the existing published Minitec table at 150 mm,
   R=0.05 m²K/W and explicit 40/30°C manifold design conditions. It does not
   silently alter radiator temperatures. Output, flow and pipe-only pressure are
   populated. A surface-temperature estimate is explicitly labelled and can be
   switched off. Existing unknown or incompatible tables remain unknown.
8. Spacing, parallel tube runs and requested circuit count are directly editable;
   Apply regenerates unlocked room circuits without resizing radiators. Maximum
   circuit length can require more circuits than requested. Each reconstructed
   tube bend exposes position/radius controls instead of sampled arc vertices.
   Unfitting radii, wall/exclusion clearance failures and proper self-crossings
   are rejected during bend editing. The two short manifold leads retain their
   own control points. Existing manual edits still require installation review.
9. UFH help defines manifold supply/return rails, port pairs, automatic creation,
   placement, assignment, heat-source connections and mixing temperatures.
10. UFH import occupies the available row with explicit vertical margins. Its
    redundant standalone help control was removed.
11. Design updates and its unused state were removed.
12. System temperatures, comparisons and layers have separate disclosures.
13. Results, pipe-order allowance and files have separate disclosures. The four
    file actions occupy an equal two-column grid.
14. Energy and Heating PDF export open a separate options/preview window first.
    A local PDF.js canvas renders actual pages with page navigation; native PDF
    browser plug-ins are not required. Title/detail changes rebuild the PDF and
    disable downloading stale content. The filename is editable and sanitised.
    Cancel does not download. Long report headings fit the PDF page width.

## Calculation boundaries

The default performance grid was already present in the repository and retains
its [Uponor installation-guide reference](https://www.uponor.com/getmedia/55d4b2f6-778d-435d-9167-0e27ea46a9eb/ufh-installation-guidepdf?sitename=UK#page=18).
Interpolation still requires complete in-range table corners. No new manufacturer
rating, extrapolation or verified installation result is fabricated.

When enabled and the table supplies no measured surface temperature, the planning
estimate uses q = 8.92 × (surface − room)^1.1, the basic radiant-floor relation
described in the [IEA SHC RADTEST report](https://fils.iea-shc.org/Data/Sites/1/publications/RADTEST_final.pdf).
This estimate propagates an estimated status and cannot become a certified pass.
Actual floor build-up, mixing, lead routing, balancing and installation checks
remain explicit inputs/review items. Old saved zones retain their existing data;
the new fields are optional and backward compatible.

## Verification

The complete frontend unit/persistence suites, production static build with
TypeScript, lint/source-usage check, targeted browser regressions and screenshot
review are recorded in `.local-logs/heating-*`. Browser sessions use isolated
saved-project fixtures and block external services. They test observable UI
interactions and persisted documents rather than exercising live installations.

The prior two lists are covered by `uiConsistency.browser.mts` and the socket,
scenario and help regression tests. The audit also exercises current project
workflows and the shared floating-window controls/docking. The entire historical
browser suite is not claimed as rerun. No worker/backend release is required for
these frontend changes.

Final checks: 660 unit tests, 19 project/persistence tests and 34 targeted browser
cases pass. Lint and source usage pass (483 modules, no orphaned modules). The
production Webpack/static export, including its TypeScript stage, passes. The
browser audit initially caught incomplete test-server MIME support for the
PDF.js `.mjs` worker; the harness now serves JavaScript modules correctly, and
actual page rendering, navigation and explicit downloads are verified. Desktop
Heating/UFH/route/PDF screenshots and the prior desktop/phone screenshots were
reviewed. Derived tube spacing displays two decimal places without rounding
the saved geometry.
