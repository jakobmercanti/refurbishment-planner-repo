# HVAC audit, pass 2 — rendered UI and workflow regression

This pass uses the actual static production export, the repository's Playwright
browser harness and the real Python deterministic preparation provider. It is a
separate UI-focused pass, not a second human reviewer or an invented solver run.

## Observed workflows

- Open the original Heating Layout window, switch Heating/Ventilation with mouse
  and arrow keys, return to Heating and retain radiator/UFH data and controls.
- Add supply and return devices; change name, dimensions and volumetric flow;
  switch L/s to m³/h; reject negative flow; duplicate, confirm removal and undo/
  redo. The saved canonical device is asserted directly, including stable IDs.
- Check real room geometry, add a hosted inlet and open CFD preflight. Create a
  new case, edit permanent flow in CFD, select scenario override and edit flow
  again. The conventional view shows the override while retaining baseline flow.
  Operating radiator off state follows the same scenario. Negative effective
  watts display validation without a project mutation or browser exception.
- Return from CFD to the real Ventilation window, retain host-face options,
  change design dimensions and verify the old package remains unchanged while
  the case status becomes outdated.
- Switch rooms without deleting hidden devices, create an editable summer
  scenario, reload and recover the same device ID.
- Return a real 503 preparation response: display its error, save no case and
  invent no completed result.
- Re-run existing Heating controls/help, insulation U-value preservation, UFH
  worker/stale-input recovery, cross-room circuit selection, generation, pipe
  editing/locks/anchors, PDF previews and existing CFD workflow/3D-drag cases.

## Visual observations and fixes

Screenshots are generated locally under `.local-logs/hvac-qa/` by
`frontend/tests/browser/hvac.browser.mts`. They contain generated test rooms.
Desktop (1440×1000), tablet (820×1180) and phone (390×844) layouts were rendered
and inspected. Native floating-window headers, help icons, fonts, colours,
control sizes, corner radii and density tokens are retained. Vent rows wrap into
a single-column action layout in narrow containers; page-overflow assertions
also pass. The same measured plan remains behind the workbench.

Screenshot review identified a misleading missing-host state after returning
from CFD. The canonical host was intact, but a component-local report was lost;
the inspector now reuses the checked geometry context across workbench switches.
The final round-trip test asserts the host no longer appears missing.

The top tabs now remain visible while scrolling a small native panel. They use
native active-tab styling and roving keyboard focus with Left/Right/Home/End.
Existing panel scrolling and window docking remain in place.

Two test-setup defects were also corrected: the old Heating help test captured
saved state before window opening finished saving, and compact-window setup
attempted to close an obscured window. The tests now await the actual opened
state and dismiss the frontmost window before opening HVAC. Heading matching
also accommodates the app's dynamically inserted help button. These changes do
not bypass pointer events or weaken the engineering assertions.

## Validation

The browser command runs serially against the rebuilt production export:

```
pnpm --dir frontend exec tsx --require ./tests/css-register.cjs --test \
  --test-reporter=tap --test-concurrency=1 \
  tests/browser/hvac.browser.mts \
  tests/browser/heatingWorkbench.browser.mts \
  tests/browser/climoptix.browser.mts
```

Final release outcomes:

- Backend/domain: **782 passed, 1 skipped**. The optional retained native CFD
  slice archive is not configured; no thermal solve is claimed. Existing FastAPI
  deprecation and pytest cache-permission warnings do not fail the suite.
- Frontend: **685 unit tests and 19 persistence tests passed**.
- Browser: **24 passed**, including 7 new HVAC cases, 10 Heating cases and 7
  established CFD cases. This final run includes shared airflow-unit persistence,
  invalid effective-power recovery, retained host faces and responsive layouts.
- ESLint/source-usage graph, production build with TypeScript, targeted Ruff and
  `git diff --check`: **passed**.

The final phone/tablet/desktop and inverse-navigation screenshots were inspected
after the last CSS build. Local evidence logs are `hvac-browser.log`,
`hvac-pytest.log`, `hvac-all-frontend-tests.log`, `hvac-lint.log` and
`hvac-build.log` in `.local-logs/`.

The native worker remains isothermal. Thermal execution, partial UFH floor-face
mapping and located zone-gain/infiltration/envelope mapping require a compatible
energy adapter. Those are explicit preparation/export limitations. Conventional
room volume uses the existing clear-height prism approximation; it is not
presented as checked sloped-roof/void volume. No humidity, local comfort or legal
compliance result is claimed.
