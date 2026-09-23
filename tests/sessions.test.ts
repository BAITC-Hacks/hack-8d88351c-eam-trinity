import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { acquireRun } from "../src/lib/ai/sessions";
import { model } from "../src/lib/model/engine";
describe("run ownership and snapshot isolation", () => {
  it("rejects a different owner and a changed plan", () => {
    const owner = randomUUID(),
      lease = acquireRun(owner, model.source_example.decisions, true);
    lease.release();
    expect(() =>
      acquireRun(randomUUID(), model.source_example.decisions, true, lease.id),
    ).toThrow("STALE_RUN");
    expect(() =>
      acquireRun(owner, model.source_example.decisions, false, lease.id),
    ).toThrow("STALE_RUN");
    const changed = structuredClone(model.source_example.decisions);
    changed[0].district_id = "esil";
    expect(() => acquireRun(owner, changed, true, lease.id)).toThrow(
      "STALE_RUN",
    );
  });
  it("blocks simultaneous use of a run, releases idempotently, and preserves history", () => {
    const owner = randomUUID(),
      lease = acquireRun(owner, model.source_example.decisions, true);
    expect(() =>
      acquireRun(owner, model.source_example.decisions, true, lease.id),
    ).toThrow("RUN_BUSY");
    lease.run.history.push({
      question: "Почему?",
      answer: { summary: "test fixture", facts: [], limitations: [] },
    });
    lease.release();
    lease.release();
    const next = acquireRun(
      owner,
      [...model.source_example.decisions].reverse(),
      true,
      lease.id,
    );
    expect(next.run.history[0].question).toBe("Почему?");
    next.release();
  });
});
