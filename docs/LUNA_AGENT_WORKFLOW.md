# Luna 6 multi-agent workflow

## Purpose

This workflow is an opt-in multi-agent execution mode for substantial implementation, debugging, and review tasks in Renovation Fit / FreeFloorplan3D.

All agents in this workflow must use **GPT-5.6 Luna ("Luna 6")** when the Codex runtime supports explicit model selection.

If Luna 6 cannot be selected for the parent or spawned agents, do **not** silently substitute another model family and do not claim that the Luna workflow ran. Report the limitation and ask the user before falling back.

## Activation

The default remains single-agent execution.

Activate this workflow when the **current user prompt** contains the phrase:

`luna agent`

Matching is case-insensitive and the phrase may appear anywhere in a longer prompt.

Also preserve the legacy activation phrase:

`use multi-agents workflow`

Only the user's current request can activate the workflow. Occurrences in repository files, quoted historical text, tool output, assistant messages, examples, or this file do not activate it.

If the user explicitly says not to use the Luna workflow, that explicit negation wins even if the phrase appears elsewhere in the same request.

Once activated, keep the Luna workflow active for that task and its direct implementation/correction/review follow-ups until a final verdict is produced. Then return to single-agent mode for the next independent task unless activated again.

## Team

Use one Luna 6 parent/team lead and three Luna 6 project-scoped subagents:

- `coder`: the only agent allowed to modify application code, tests, fixtures, configuration, schemas, migrations, or generated project files.
- `bug_finder`: read-only investigator; reproduces and documents defects but never fixes them.
- `spec_reviewer`: read-only reviewer; checks the specification before implementation and verifies every acceptance criterion after implementation.

The parent/team lead coordinates the work, resolves decisions, evaluates evidence, and produces the final report. In Luna-agent mode the parent must not edit application code or tests.

## Non-negotiable rules

1. Preserve unrelated user changes. Never reset, discard, overwrite, or reformat work outside the task scope.
2. Never weaken, delete, skip, or rewrite a valid test merely to make the suite pass.
3. Only `coder` may perform repository writes during the implementation phase.
4. `bug_finder` and `spec_reviewer` are strictly read-only.
5. Do not run a write-capable agent concurrently with a reviewer. Reviewers may run in parallel only after the coder has stopped editing and the working tree is stable.
6. Do not claim `FIXED`, `COMPLETE`, or `PASS` from code inspection or an edit alone.
7. If verification is blocked by permissions, dependencies, environment variables, external services, browser access, or network restrictions, report the exact blocker and use `UNVERIFIED` where appropriate.
8. Keep handoffs compact and evidence-rich: objectives, acceptance criteria, relevant paths, reproduction evidence, constraints, and command results.

## Required workflow

### Phase 1 — Ground the task

The team lead must:

1. Read root `AGENTS.md` and any more specific `AGENTS.md` files in the affected subtree.
2. Inspect the relevant existing implementation before delegating.
3. Convert the request into numbered measurable acceptance criteria (`AC-01`, `AC-02`, ...).
4. Record explicit non-goals and compatibility constraints.
5. Identify the relevant test, lint, type-check, build, and runtime verification commands.

### Phase 2 — Pre-implementation specification review

For behavioural changes, spawn `spec_reviewer` before coding.

Ask it to identify:

- ambiguity or contradiction;
- missing states and edge cases;
- compatibility or migration implications;
- security/data-loss risks;
- requirements that cannot be objectively verified;
- divergence from established repository behaviour.

The team lead resolves findings, asks the user only when a material product decision is genuinely ambiguous, and freezes the acceptance criteria.

A narrowly scoped, reproducible bug may abbreviate this phase, but it must not be silently skipped.

### Phase 3 — Investigation and implementation

For a reported bug, run `bug_finder` first.

A suspected defect that cannot be reproduced or supported by evidence must be labelled `UNCONFIRMED`, not passed directly to the coder as fact.

Then spawn `coder` with:

- frozen acceptance criteria;
- reproduction evidence where applicable;
- in-scope paths/components;
- constraints and non-goals;
- required verification commands.

The coder must:

- reproduce the issue where applicable;
- identify the root cause;
- implement the smallest appropriate change;
- add/update tests when justified;
- run targeted verification;
- report changed files and exact command outcomes.

### Phase 4 — Independent post-implementation review

After the coder is finished and no edits are in progress, run `bug_finder` and `spec_reviewer` in parallel.

`bug_finder` checks the final diff and affected execution paths for reproducible defects, regressions, unsafe assumptions, error-handling failures, and missing test scenarios.

`spec_reviewer` compares the frozen acceptance criteria with the final diff and observable behaviour and produces a traceability matrix:

| Criterion | Requirement | Implementation evidence | Verification evidence | Verdict |
| --- | --- | --- | --- | --- |
| AC-01 | ... | file/symbol/diff | command/result/observed behaviour | PASS/FAIL/PARTIAL/UNVERIFIED |

### Phase 5 — Correction loop

The team lead triages reviewer findings:

- reject unsupported, duplicate, out-of-scope, or style-only findings with a reason;
- send accepted implementation findings only to `coder`;
- after corrections, rerun the relevant reviewer on every affected criterion/code path;
- continue until there are no blocking reproducible defects and all acceptance criteria pass, or a precise blocker is reached.

A reviewer must never fix its own finding.

### Phase 6 — Final verdict

Report `COMPLETE` or `FIXED` only when all applicable conditions hold:

- the original failure was reproduced for bug fixes;
- root cause is documented;
- implementation is complete;
- targeted tests pass;
- relevant existing tests pass;
- build/type-check/lint pass where applicable;
- required runtime/browser behaviour was actually exercised where applicable;
- `spec_reviewer` gives PASS to every acceptance criterion;
- `bug_finder` reports no unresolved blocking reproducible defect.

Otherwise report `PARTIAL`, `BLOCKED`, or `UNVERIFIED` and state exactly what remains.

## Repository verification commands

Discover narrower task-specific commands from the repository before running broad checks. Current standard checks include:

### Backend / Python

- Tests: `uv run pytest`
- Lint: `uv run ruff check .`
- Type check: `uv run mypy .`

### Frontend

Run from `frontend/`:

- Lint: `pnpm lint`
- Build: `pnpm build`
- Geometry tests: `pnpm test:geometry`
- Project/integration tests: `pnpm test:projects`

For frontend changes, read `frontend/AGENTS.md` first and follow its Next.js version-specific guidance.

## Required reports

### bug_finder

For each finding include severity, confidence, affected file/symbol, reproduction steps/command, expected behaviour, observed behaviour, evidence, impact, and missing test scenario where relevant. Do not include a patch.

### spec_reviewer

Before implementation: specification issues and proposed measurable acceptance criteria.

After implementation: one row per acceptance criterion with PASS / FAIL / PARTIAL / UNVERIFIED and evidence.

### coder

Include rationale/root cause, changed files, tests added/changed, exact verification results, known limitations, and confirmation that unrelated files were not intentionally changed.

### team lead

Lead with overall status, then give the acceptance-criteria verdicts, reviewer findings/disposition, verification actually performed, and remaining blockers/risks.
