import assert from "node:assert/strict";
import test from "node:test";
import { GET, dynamic } from "../app/plans/route";

test("the local public plans fallback reuses production markup at both supported base paths without embedding a session", async () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    for (const base of ["", "/planner"]) {
      process.env.NEXT_PUBLIC_BASE_PATH = base;
      const response = GET(), html = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type")!, /text\/html/);
      assert.equal(response.headers.get("x-robots-tag"), "noindex");
      assert.ok(html.includes(`href="${base}/account/"`));
      assert.ok(html.includes(`action="${base}/checkout/"`));
      assert.ok(html.includes(`fetch('${base}/engineering-api/commercial/`));
      if (!base) assert.ok(!html.includes("/planner/"));
      assert.match(html, /No payment is taken until you confirm/);
    }
    assert.equal(dynamic, "force-static");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
});
