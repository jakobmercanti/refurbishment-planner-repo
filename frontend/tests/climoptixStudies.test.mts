import assert from "node:assert/strict";
import test from "node:test";
import { insertAtBoundary, moveStudy } from "../lib/climoptixStudies";
import {
  checkedWorkerJob,
  terminalJob,
  prepareWorkerSubmission,
} from "../lib/climoptixJobs";
import {
  cfdScenarioSchema,
  duplicateCFDScenario,
} from "../lib/climoptixDocument";
import {
  preparationInput,
  preparationRevision,
  preparationRequestBody,
} from "../lib/climoptix";
import { cfdProject, realPreparation } from "./climoptixFixtures";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClimoptixStudies } from "../components/ClimoptixStudies";

test("insertion boundaries move adjacent and distant items in both directions without mutating the source", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  for (let source = 0; source < items.length; source++)
    for (let boundary = 0; boundary <= items.length; boundary++) {
      const moved = insertAtBoundary(items, items[source].id, boundary);
      assert.deepEqual([...moved.map((x) => x.id)].sort(), [
        "a",
        "b",
        "c",
        "d",
      ]);
      const expected = boundary > source ? boundary - 1 : boundary;
      assert.equal(moved[expected].id, items[source].id);
      assert.deepEqual(
        items.map((x) => x.id),
        ["a", "b", "c", "d"],
      );
    }
  for (const at of [-1, 5, NaN, 1.2])
    assert.equal(insertAtBoundary(items, "a", at), items);
  assert.equal(insertAtBoundary(items, "missing", 1), items);
});

test("study groups reorder and transfer by stable ID without touching settings or unrelated groups", () => {
  const base = cfdProject().cfdScenarios![0];
  const studies = ["a", "b", "c", "d"].map((id, i) => ({
    ...structuredClone(base),
    id,
    group: i < 2 ? "Summer" : "Winter",
  }));
  const original = structuredClone(studies);
  assert.deepEqual(
    moveStudy(studies, "b", "Summer", 0).map((s) => s.id),
    ["b", "a", "c", "d"],
  );
  const moved = moveStudy(studies, "a", "Winter", 1);
  assert.deepEqual(
    moved.map((s) => s.id),
    ["b", "c", "a", "d"],
  );
  assert.equal(moved.find((s) => s.id === "a")?.group, "Winter");
  assert.deepEqual(
    moved.find((s) => s.id === "a")?.physics,
    studies[0].physics,
  );
  assert.deepEqual(
    moveStudy(studies, "d", "New group", 0).map((s) => s.group),
    ["Summer", "Summer", "Winter", "New group"],
  );
  assert.deepEqual(studies, original);
  assert.equal(moveStudy(studies, "missing", "Summer", 0), studies);
  assert.equal(moveStudy(studies, "a", " ", 0), studies);
  assert.equal(moveStudy(studies, "a", "Summer", 99), studies);
});

test("legacy studies default to General and group labels are bounded presentation metadata in both contracts", async () => {
  const project = cfdProject(),
    study = project.cfdScenarios![0];
  const legacy = { ...study };
  delete (legacy as Partial<typeof study>).group;
  assert.equal(cfdScenarioSchema.parse(legacy).group, "General");
  for (const group of ["", " ", "x".repeat(81)])
    assert.equal(
      cfdScenarioSchema.safeParse({ ...study, group }).success,
      false,
    );
  const grouped = { ...study, group: "Summer · low wind" };
  assert.equal(duplicateCFDScenario(grouped).group, grouped.group);
  assert.equal(
    preparationInput(project, study),
    preparationInput(project, grouped),
  );
  const revision = await preparationRevision(preparationInput(project, study));
  assert.equal(
    "group" in
      JSON.parse(preparationRequestBody(project, grouped, revision)).scenario,
    false,
  );
  const first = realPreparation(
    JSON.parse(preparationRequestBody(project, study, revision)),
  );
  const second = realPreparation(
    JSON.parse(preparationRequestBody(project, grouped, revision)),
  );
  assert.equal(
    first.validation.configurationHash,
    second.validation.configurationHash,
  );
  assert.equal(first.validation.sourceHash, second.validation.sourceHash);
});

test("worker progress is accepted only for the matching job, study and revision; no completion is fabricated", () => {
  const expected = {
    id: "worker-1",
    studyId: "summer",
    clientRevision: "a".repeat(64),
  };
  const queued = checkedWorkerJob(
    { ...expected, phase: "Queued", progress: null },
    expected,
  );
  assert.equal(queued.progress, null);
  assert.equal(terminalJob(queued), false);
  const running = checkedWorkerJob(
    { ...expected, phase: "Running", progress: 42.5 },
    expected,
  );
  assert.equal(running.progress, 42.5);
  for (const phase of ["Completed", "Failed", "Cancelled"])
    assert.equal(
      terminalJob(
        checkedWorkerJob({ ...expected, phase, progress: null }, expected),
      ),
      true,
    );
  for (const patch of [
    { id: "other" },
    { studyId: "winter" },
    { clientRevision: "b".repeat(64) },
    { phase: "Invented" },
    { progress: 101 },
    { progress: -1 },
    { progress: Infinity },
  ]) {
    assert.throws(() => checkedWorkerJob({ ...running, ...patch }, expected));
  }
});

test("worker handoffs require real preflight, preserve mm and resource settings, and reject errors and cancellation", async () => {
  const project = cfdProject(),
    scenario = project.cfdScenarios![0];
  scenario.resources.cpu = 8;
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/climoptix/prepare");
      calls++;
      const body = JSON.parse(options!.body as string);
      return new Response(JSON.stringify(realPreparation(body)), {
        headers: { "Content-Type": "application/json" },
      });
    };
    const request = await prepareWorkerSubmission(
      "/api",
      project,
      scenario,
      "mesh",
      new AbortController().signal,
    );
    assert.equal(request.operation, "mesh");
    assert.equal(request.scenario.resources.cpu, 8);
    assert.deepEqual(request.scenario.mesh, scenario.mesh);
    assert.equal(
      request.clientRevision,
      await preparationRevision(preparationInput(project, scenario)),
    );
    scenario.resources.cpu = 12;
    assert.equal(
      request.scenario.resources.cpu,
      8,
      "The worker receives an independent settings snapshot",
    );
    const blocked = { ...scenario, seed: null };
    await assert.rejects(
      () =>
        prepareWorkerSubmission(
          "/api",
          project,
          blocked,
          "run",
          new AbortController().signal,
        ),
      /Preflight blocked/,
    );
    const beforeAbort = calls;
    await assert.rejects(() =>
      prepareWorkerSubmission(
        "/api",
        project,
        scenario,
        "run",
        AbortSignal.abort(),
      ),
    );
    assert.equal(
      calls,
      beforeAbort,
      "Cancelled work must not contact preflight or a worker",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("study rows show only the worker's current-phase progress, never a synthetic completed percentage", () => {
  const project = cfdProject(),
    scenario = project.cfdScenarios![0];
  const props: Parameters<typeof ClimoptixStudies>[0] = {
    project,
    scenarios: project.cfdScenarios!,
    scenario,
    showArchived: false,
    onShowArchived() {},
    onSelect() {},
    onChange() {},
    onOrder() {},
    onAdd() {},
    onDuplicate() {},
    onDelete() {},
    onImport() {},
    onConvergence() {},
    onSubmit() {},
    onUndo() {},
    onRedo() {},
    canUndo: false,
    canRedo: false,
    entries: {
      [scenario.id]: {
        input: preparationInput(project, scenario),
        job: {
          id: "job",
          studyId: scenario.id,
          clientRevision: "a".repeat(64),
          phase: "Meshing",
          progress: 37,
          message: "snappyHexMesh refinement",
        },
      },
    },
    worker: {
      capabilities: { connected: true, mesh: true, run: true, reason: "" },
      async submit() {
        throw new Error("No submit during rendering");
      },
      async status() {
        throw new Error("No polling during rendering");
      },
    },
  };
  const rendering = renderToStaticMarkup(
    createElement(ClimoptixStudies, props),
  );
  assert.match(rendering, /aria-valuenow="37"/);
  assert.match(rendering, /Meshing · 37% of phase/);
  const job = props.entries[scenario.id].job!;
  job.phase = "Completed";
  job.progress = null;
  const complete = renderToStaticMarkup(createElement(ClimoptixStudies, props));
  assert.doesNotMatch(complete, /aria-valuenow=/);
  assert.match(complete, /progress not reported/);
});
