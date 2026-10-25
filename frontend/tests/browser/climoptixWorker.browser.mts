import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cfdProject, realPreparation } from "../climoptixFixtures";
import { duplicateCFDScenario } from "../../lib/climoptixDocument";
import { eventually, startBrowserHarness } from "./harness.mjs";

let harness, bundle;
before(async () => {
  const { build } = createRequire(import.meta.resolve("tsx"))("esbuild");
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL("./fixtures/cfdWorkerFixture.tsx", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
  });
  bundle = result.outputFiles[0].text;
  harness = await startBrowserHarness();
});
after(async () => {
  await harness?.close();
});

async function fixture(t, project = cfdProject(), prepare?) {
  const session = await harness.session(null);
  t.after(() => session.close());
  await session.context.addInitScript((project) => {
    window.initialProject = project;
  }, project);
  await session.context.route("**/worker-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/worker-fixture.js"></script>',
    }),
  );
  await session.context.route("**/worker-fixture.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: bundle }),
  );
  await session.context.route(
    "**/climoptix/prepare",
    prepare ??
      ((route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(realPreparation(route.request().postDataJSON())),
        })),
  );
  await session.page.goto(harness.origin + "/worker-fixture");
  await session.page
    .getByRole("button", { name: "Select Office airflow", exact: true })
    .waitFor();
  return session;
}

test("row Mesh/Run actions submit the correct study independently and block archived or disconnected studies", async (t) => {
  const project = cfdProject(),
    first = project.cfdScenarios![0],
    second = duplicateCFDScenario(first),
    archived = duplicateCFDScenario(first);
  second.name = "Alternative";
  second.resources.cpu = 8;
  archived.name = "Archived study";
  archived.archived = true;
  project.cfdScenarios!.push(second, archived);
  const { page } = await fixture(t, project);
  assert.equal(await page.getByRole("progressbar").count(), 0);
  await page.getByRole("button", { name: "Mesh Office airflow", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Clear all", exact: true }).isDisabled(), "Clear all must not remove active worker submissions");
  await page.getByRole("button", { name: "Run Alternative", exact: true }).click();
  const requests = await eventually(
    () => page.evaluate(() => window.cfdFixture.transport.submissions),
    (s) => s.length === 2,
  );
  assert.equal(requests.find((r) => r.studyId === first.id).operation, "mesh");
  assert.equal(requests.find((r) => r.studyId === second.id).operation, "run");
  assert.equal(requests.find((r) => r.studyId === second.id).scenario.resources.cpu, 8);
  assert.equal(await page.getByRole("button", { name: `Select ${first.name}`, exact: true }).getAttribute("aria-pressed"), "true",
    "Submitting another row must not switch the selected study");
  for (const name of [first.name, second.name]) {
    for (const action of ["Mesh", "Run", "Delete"])
      assert.ok(await page.getByRole("button", { name: `${action} ${name}`, exact: true }).isDisabled());
    assert.equal(await page.getByRole("progressbar", { name: `${name} phase progress`, exact: true }).getAttribute("aria-valuenow"), null);
  }
  await page.getByRole("checkbox", { name: "Archived", exact: true }).check();
  for (const action of ["Mesh", "Run"])
    assert.ok(await page.getByRole("button", { name: `${action} ${archived.name}`, exact: true }).isDisabled());
  await page.evaluate(() => {
    for (const job of Object.values(window.cfdFixture.transport.jobs)) job.phase = "Completed";
  });
  await eventually(() => page.getByRole("button", { name: "Run Alternative", exact: true }).isEnabled(), Boolean);
  await page.evaluate(() => window.cfdFixture.connect(false));
  for (const name of [first.name, second.name]) {
    for (const action of ["Mesh", "Run"])
      assert.ok(await page.getByRole("button", { name: `${action} ${name}`, exact: true }).isDisabled());
  }
  assert.equal((await page.evaluate(() => window.cfdFixture.transport.submissions)).length, 2);
});

test("worker batch reservations remain atomic, preserve handoff settings and show only checked real progress", async (t) => {
  const project = cfdProject(),
    first = project.cfdScenarios![0],
    second = duplicateCFDScenario(first);
  second.name = "Alternative";
  second.resources.cpu = 8;
  project.cfdScenarios!.push(second);
  const { page } = await fixture(t, project);
  await page.evaluate(
    (ids) => {
      window.cfdFixture.submit(ids);
      window.cfdFixture.submit(ids);
    },
    [first.id, second.id],
  );
  const requests = await eventually(
    () => page.evaluate(() => window.cfdFixture.transport.submissions),
    (s) => s.length === 2,
  );
  assert.equal(new Set(requests.map((s) => s.studyId)).size, 2);
  for (const request of requests) {
    assert.equal(request.contractVersion, 1);
    assert.equal(request.dialect, "OpenCFD-v2312");
    assert.equal(request.sourceUnits, "mm");
    assert.equal(request.operation, "run");
    assert.match(request.clientRevision, /^[a-f0-9]{64}$/);
    assert.match(request.sourceHash, /^[a-f0-9]{64}$/);
  }
  assert.equal(requests[1].scenario.resources.cpu, 8);
  await eventually(
    () => page.getByRole("button", { name: "Delete Alternative" }).isDisabled(),
    Boolean,
  );
  await page.evaluate(() => {
    const transport = window.cfdFixture.transport;
    for (const job of Object.values(transport.jobs)) {
      job.phase = "Meshing";
      job.progress = 27;
    }
  });
  await eventually(
    () =>
      page
        .getByRole("progressbar", { name: "Alternative phase progress" })
        .getAttribute("aria-valuenow"),
    (v) => v === "27",
  );
  await page.evaluate((id) => window.cfdFixture.editCpu(id, 16), second.id);
  await page
    .getByRole("button", { name: "Select Alternative", exact: true })
    .filter({ hasText: "older setup" })
    .waitFor();
  await page.evaluate(() => {
    window.cfdFixture.transport.wrongIdentity = true;
  });
  await eventually(
    () => page.getByRole("alert").allTextContents(),
    (values) => values.some((v) => /different study/.test(v)),
  );
  assert.equal(
    await page
      .getByRole("progressbar", { name: "Alternative phase progress" })
      .getAttribute("aria-valuenow"),
    "27",
  );
  await page.evaluate(() => {
    const transport = window.cfdFixture.transport;
    transport.wrongIdentity = false;
    for (const job of Object.values(transport.jobs)) {
      job.phase = "Completed";
      job.progress = null;
    }
  });
  await eventually(
    () => page.getByRole("button", { name: "Delete Alternative" }).isEnabled(),
    Boolean,
  );
  assert.equal(
    await page
      .getByRole("progressbar", { name: "Alternative phase progress" })
      .getAttribute("aria-valuenow"),
    null,
  );
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /awaiting phase progress/,
  );
  assert.equal(
    (await page.evaluate(() => window.cfdFixture.transport.submissions)).length,
    2,
  );
});

test("a failed preflight affects only its study and setup changes during preflight prevent worker submission", async (t) => {
  const project = cfdProject(),
    first = project.cfdScenarios![0],
    blocked = duplicateCFDScenario(first);
  blocked.seed = null;
  blocked.name = "Missing seed";
  project.cfdScenarios!.push(blocked);
  let held, release;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { page } = await fixture(t, project, async (route) => {
    const body = route.request().postDataJSON(),
      report = realPreparation(body);
    if (body.scenario.id === first.id) {
      held = true;
      await gate;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(report),
    });
  });
  await page.evaluate(
    (ids) => window.cfdFixture.submit(ids),
    [first.id, blocked.id],
  );
  await eventually(() => held, Boolean);
  await page.evaluate((id) => window.cfdFixture.editCpu(id, 12), first.id);
  await eventually(
    () => page.evaluate(() => window.cfdFixture.read()),
    (entries) => Object.keys(entries).length === 2,
  );
  release();
  await eventually(
    () => page.getByRole("alert").allTextContents(),
    (values) => values.length === 2,
  );
  assert.match(
    (await page.getByRole("alert").allTextContents()).join(),
    /Setup changed before submission/,
  );
  assert.match(
    (await page.getByRole("alert").allTextContents()).join(),
    /Preflight blocked/,
  );
  assert.equal(
    await page.evaluate(() => window.cfdFixture.transport.submissions.length),
    0,
  );
  await page.evaluate((id) => window.cfdFixture.submit([id], "mesh"), first.id);
  const requests = await eventually(
    () => page.evaluate(() => window.cfdFixture.transport.submissions),
    (s) => s.length === 1,
  );
  assert.equal(requests[0].scenario.resources.cpu, 12);
  assert.equal(requests[0].operation, "mesh");
});

test("ambiguous submission retries reuse their ID, status failures retain the job, and new runs get a fresh ID", async (t) => {
  const project = cfdProject(),
    id = project.cfdScenarios![0].id;
  const { page } = await fixture(t, project);
  await page.evaluate((id) => {
    window.cfdFixture.transport.failSubmit = true;
    window.cfdFixture.submit([id]);
  }, id);
  await page.getByRole("alert").filter({ hasText: "Response lost" }).waitFor();
  await page
    .getByRole("button", { name: "Select Office airflow", exact: true })
    .filter({ hasText: "Submission status unknown" })
    .waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "Delete Office airflow" })
      .isDisabled(),
  );
  assert.ok(await page.getByRole("button", { name: "Mesh Office airflow", exact: true }).isDisabled());
  assert.ok(await page.getByRole("button", { name: "Run Office airflow", exact: true }).isEnabled());
  await page.evaluate((id) => window.cfdFixture.submit([id], "mesh"), id);
  await page
    .getByRole("alert")
    .filter({ hasText: "Recover the previous run submission" })
    .waitFor();
  await page.evaluate((id) => window.cfdFixture.editCpu(id, 12), id);
  await page.evaluate(() => { window.cfdFixture.transport.failSubmit = false; });
  await page.getByRole("button", { name: "Run Office airflow", exact: true }).click();
  const requests = await eventually(
    () => page.evaluate(() => window.cfdFixture.transport.submissions),
    (s) => s.length === 2,
  );
  assert.equal(requests[0].submissionId, requests[1].submissionId);
  assert.deepEqual(
    requests[0],
    requests[1],
    "Recovery resends the original immutable payload, even if setup was edited meanwhile",
  );
  await page.evaluate(() => {
    window.cfdFixture.transport.failStatus = true;
  });
  await page
    .getByRole("alert")
    .filter({ hasText: "Temporary status failure" })
    .waitFor();
  await page.evaluate((id) => window.cfdFixture.submit([id]), id);
  assert.equal(
    await page.evaluate(() => window.cfdFixture.transport.submissions.length),
    2,
    "A polling failure is not permission to submit another job",
  );
  await page.evaluate(() => {
    const transport = window.cfdFixture.transport;
    transport.failStatus = false;
    for (const job of Object.values(transport.jobs)) {
      job.phase = "Completed";
      job.progress = 100;
    }
  });
  await eventually(
    () =>
      page.getByRole("button", { name: "Delete Office airflow" }).isEnabled(),
    Boolean,
  );
  await page.evaluate((id) => window.cfdFixture.submit([id]), id);
  const next = await eventually(
    () => page.evaluate(() => window.cfdFixture.transport.submissions),
    (s) => s.length === 3,
  );
  assert.notEqual(next[2].submissionId, next[1].submissionId);
  assert.equal(next[2].scenario.resources.cpu, 12);
});

test("connection replacement and unmount abort pending submissions without leaving studies permanently busy", async (t) => {
  const project = cfdProject(),
    id = project.cfdScenarios![0].id;
  const { page } = await fixture(t, project);
  await page.evaluate((id) => {
    window.cfdFixture.transport.holdSubmit = true;
    window.cfdFixture.submit([id]);
  }, id);
  await eventually(
    () => page.evaluate(() => window.cfdFixture.transport.submissions.length),
    (n) => n === 1,
  );
  await page.evaluate(() => window.cfdFixture.connect(false));
  await page
    .getByRole("alert")
    .filter({ hasText: "Connection changed" })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.cfdFixture.transport.aborts),
    1,
  );
  assert.equal(
    await page.evaluate((id) => window.cfdFixture.read()[id].submitting, id),
    false,
  );
  assert.ok(
    await page
      .getByRole("button", { name: "Delete Office airflow" })
      .isDisabled(),
    "Unknown accepted submissions must be recovered before deletion",
  );
  await page.evaluate(() => {
    window.cfdFixture.transport.holdSubmit = false;
    window.cfdFixture.connect(true);
  });
  await eventually(
    () => page.getByRole("button", { name: "Run Office airflow", exact: true }).isEnabled(),
    Boolean,
  );
  await page.getByRole("button", { name: "Run Office airflow", exact: true }).click();
  await eventually(
    () => page.evaluate(() => window.cfdFixture.transport.submissions.length),
    (n) => n === 2,
  );
  const requests = await page.evaluate(
    () => window.cfdFixture.transport.submissions,
  );
  assert.equal(requests[0].submissionId, requests[1].submissionId);
  await page.evaluate(() => window.cfdFixture.unmount());
  const polls = await page.evaluate(
    () => window.cfdFixture.transport.statusCalls,
  );
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.equal(
    await page.evaluate(() => window.cfdFixture.transport.statusCalls),
    polls,
  );
});
