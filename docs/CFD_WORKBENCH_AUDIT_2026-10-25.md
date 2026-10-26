# Offline CFD workbench audit

Latest authority: finish the screenshot update list and commit to LOCAL master.
No remote push, Railway deploy, worker restart or Cloudflare release is permitted
by this instruction. The original backend remains the live service. Preserve the
unrelated nested website checkout and remote attachments.

## Local implementation audit — 26 October 2026

1. Simulation cards contain name/actions plus a progress bar; the separate third
   status line is removed. Worker messages are included in the bar itself.
2. Probe rows live in Solver > Post, keep XYZ visible, and offer duplicate/remove
   menus and confirmed bulk clear. Real R3F spheres and accessible projected
   labels select the same probe; selected material/label is orange.
3. Worker policy failures name the actual incompatible equations/preset/coupling
   and repair location. The Review panel shows current settings and navigation.
   Connected-worker UI no longer repeats the misleading no-worker preparation text.
4. Requested outputs and probes moved out of Physics into Solver > Post.
5. Every solver subtab has worker progress. Phase steps and iteration budget are
   explicitly distinguished from elapsed time and convergence. Missing old-worker
   telemetry stays unknown; idle simulations display zero. No fake time estimates.
6. Phase/subcommand messages appear in the progress bar; no redundant study line.
7. Post actions use equal-width aligned columns, including the import label.
8. Verified online archives open in an independent navigable folder window. Folder
   rows open by double-click or keyboard Enter, not a wall of folder buttons.
   Original authenticated/SHA-checked archive and post-processing downloads remain.
9. The independent plane inspector has a manifest plane selector and a large
   bounded viewport. Controls scroll independently, with fields, legends, object
   visibility, volume slices and scalar isosurfaces retained. No scroll hack.
10. Explicit verified-plane loading into the building R3F viewer triangulates
    native polygon data and maps metre coordinates at the rendering boundary.
    Changed/older geometry and external/unknown-unit files cannot silently overlay.
    Main-view field selection and visibility remain session-only presentation.
11. Shared floating-window minimize header and layout-menu actions preserve the
    mounted body/draft/layout and restore from bottom-left task tabs. They do not
    repurpose Close, and multiple minimized windows receive separate tabs.
12. Navigation preferences use normal label/control typography and alignment.
13. Separate residual graphs use full available history. Default Ux/Uy/Uz/p gives
    a 2x2 desktop grid; a dropdown adds/removes fields and selects initial/final
    residual measure. Repeated pressure corrections do not create vertical fans.
14. Independent thermal imports reuse the existing insulation contract editor.
    Heating import links existing measured radiators and checked UFH floor patches
    to explicitly reviewed temperatures, never water temperatures/rated watts.
    Watt input is cleared when surface temperature is chosen, avoiding double
    counting. Source geometry/design is not modified or duplicated.
15. Temperature/flow preference controls are separately labelled responsive fields;
    CFD dropdowns retain the shared controls and authoritative K/mm/SI storage.

Earlier requests remain included: Clear all removes presentation groups;
Restore default creates one coarse runnable case/group with opposite vents;
metrics use readable 3/4-column layout; native legacy VTK FIELD data is accepted.

## Explicit limits — do not misrepresent as completed solver capabilities

- Native worker still supports steady isothermal U/p only. Heating/insulation
  handoff is preparation/export, NOT an executed thermal CFD simulation. A reviewed
  thermal-capable solver and native acceptance run are still required for actual
  radiator/UFH temperature/buoyancy results. Applying heat deliberately prevents
  silently running an incompatible isothermal job.
- UFH import uses whole checked floor patches, not resolved pipe-loop coverage.
- Scalar isosurfaces require real imported point-scalar VTI volume data. The
  current worker does not compute passive scalar fields.
- Native progress is measured command/file steps and iteration budget; it is not
  predicted elapsed-time completion. An old deployed worker will not emit new
  telemetry until explicitly released later. This work remains offline.
- Full available convergence history is subject to the existing bounded log
  parser; truncation is disclosed rather than concealed.

## Acceptance and verification

Items 1–13 and 15 are implemented locally and covered by the audit. Item 14 has
the independent, measured-source import and insulation contract handoff; actual
thermal CFD solving is NOT implemented by the present native worker. That is an
explicit remaining solver capability, not a successful thermal simulation.

Fresh checks against the final sources/build:

- Backend: `uv run pytest -q` — 696 passed, two pre-existing warnings.
  Evidence: `.local-logs/cfd-final-backend.log`.
- Frontend: `pnpm test` — 626 unit and 19 project-persistence tests passed.
  Evidence: `.local-logs/cfd-verified-unit.log`.
- `pnpm lint` and `pnpm typecheck` passed; source usage covers 448 modules with
  no orphaned modules. Static production Webpack build passed. Generated
  next-env.d.ts was restored to its original development imports afterwards.
- Deployment proxy/auth/local-preview regressions: 29 passed. Sandbox localhost
  restrictions required rerunning the preview test with local network access;
  that environment failure was not treated as an application failure.
- 93 distinct browser cases passed across the audit and targeted reruns, not one
  uninterrupted 93-case command. Logs: `cfd-resumed-regression.tap`,
  `cfd-final-recovery.tap`, `cfd-final-browser.tap`, `cfd-final-affected.tap`, and
  `cfd-final-boundary-draft.tap` under `.local-logs/`. The full screenshot file
  subsequently passed all six cases in `cfd-verified-screenshot.tap`. Earlier failing assertions
  remain visible in those logs; each has a later passing rerun. The last boundary
  test was corrected to expect the validated starter case's two existing vents,
  rather than an empty case. Its new vent remains grouped and host-assigned.
- Actual production R3F store/material/camera tests verify orange selection,
  pointer placement/drag, mm-to-scene coordinates, and the verified result mesh.
  VTK tests decode retained real OpenFOAM FIELD planes, not generated visual
  substitutes. Rendering also covers field/vector selection, legends, object
  visibility, grid slices and a computed scalar isosurface from actual VTI values.
- Both thermal themes and desktop/tablet/phone layouts passed, including source
  wall/door editor round trips, invalid drafts, pinned footer and narrow resizing.
  Two simultaneously minimized windows restore separate geometry/settings.
- Screenshots in `.local-logs/cfd-results-qa/` were inspected for the native
  plane inspector, mobile scalar viewer and mobile thermal review/footer.

Audit fixes included a portal-parent focus race, hidden Results prefetching that
duplicated recovery requests, lost docking after workspace switches, service-help
decoration exposing two thermal navigation modes, and an inherited 360px mobile
bottom-sheet limit clipping the new independent windows. The log parser now
retains all 5,000 default four-field steps despite repeated pressure corrections;
the original bounded input/field limits still apply and truncation is disclosed.

No fresh cloud/native simulation, remote Git push, Railway deployment, worker
restart, Cloudflare release or user-browser mutation was performed. The historical
native archive proves retained-file compatibility only. Old deployed workers
continue to show unknown progress where they do not emit the new telemetry.
Unrelated nested website and attachment changes are excluded from the local commit.
