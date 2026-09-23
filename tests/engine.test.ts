import { describe, it, expect } from "vitest";
import source from "../hackalem_model.json";
import {
  aggregate,
  computeBaseline,
  evaluateScenario,
  runStress,
  model,
  metricIds,
  validate,
  resolveIndicator,
  type Decision,
  type Result,
} from "../src/lib/model/engine";
const example = model.source_example.decisions;
function evaluate(decisions: Decision[]): Result {
  const result = evaluateScenario({ decisions });
  if (!result.valid) throw new Error(JSON.stringify(result.errors));
  return result.result;
}
const plan = (...entries: (string | [string, string])[]) =>
  entries.map((e) =>
    typeof e === "string"
      ? { measure_id: e }
      : { measure_id: e[0], district_id: e[1] },
  ) as Decision[];
describe("official model", () => {
  it("clips once after all positive and negative effects, independently of order", () => {
    const deltas = [{ delta: 10 }, { delta: -5 }];
    expect(resolveIndicator(98, deltas)).toEqual({
      beforeClip: 103,
      value: 100,
    });
    expect(resolveIndicator(98, [...deltas].reverse())).toEqual(
      resolveIndicator(98, deltas),
    );
    expect(resolveIndicator(1, [{ delta: -4 }])).toEqual({
      beforeClip: -3,
      value: 0,
    });
  });
  it("has complete source data and normalized weights", () => {
    expect(model.measures).toHaveLength(14);
    expect(model.districts).toHaveLength(5);
    expect(model.metrics.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(1, 12);
    expect(
      model.districts.reduce((s, d) => s + d.population_share, 0),
    ).toBeCloseTo(1, 12);
    for (const d of model.districts)
      expect(Object.keys(d.indicators)).toHaveLength(10);
  });
  it("matches all baseline reference aggregates", () => {
    const r = computeBaseline();
    expect(r.score).toBeCloseTo(source.verification.baseline.score, 8);
    expect(r.cityMean).toBeCloseTo(source.verification.baseline.city_mean, 8);
    expect(r.criticalPairs).toHaveLength(2);
    for (const d of model.districts)
      expect(r.districtTotals[d.id]).toBeCloseTo(
        source.verification.baseline.district_totals[d.id],
        8,
      );
  });
  it("matches every indicator and aggregate in organizer example", () => {
    const r = evaluate(example);
    expect(r.score).toBeCloseTo(source.verification.source_example.score, 8);
    expect(r.cityMean).toBeCloseTo(
      source.verification.source_example.city_mean,
      8,
    );
    expect(r.cost).toBe(95);
    expect(r.remaining).toBe(5);
    expect(r.criticalPairs).toHaveLength(0);
    for (const d of model.districts) {
      expect(r.districtTotals[d.id]).toBeCloseTo(
        source.verification.source_example.district_totals[d.id],
        8,
      );
      for (const k of metricIds)
        expect(r.indicators[d.id][k]).toBeCloseTo(
          source.verification.source_example.updated_indicators[d.id][k],
          8,
        );
    }
  });
  it.each([0, 4, 6])("rejects %i decisions without a score", (n) => {
    const decisions = Array.from({ length: n }, (_, i) => ({
      measure_id: `M${i + 1}`,
      district_id: "nura",
    }));
    expect(evaluateScenario({ decisions })).toMatchObject({
      valid: false,
      score: null,
    });
  });
  it("rejects duplicate measures across different districts", () => {
    expect(
      validate({
        decisions: plan(
          ["M7", "nura"],
          ["M7", "esil"],
          ["M10", "nura"],
          "M12",
          ["M4", "saryarka"],
        ),
      }).map((e) => e.code),
    ).toContain("DUPLICATE");
  });
  it("rejects third measure in a direction", () =>
    expect(
      validate({
        decisions: plan(["M7", "nura"], ["M8", "nura"], ["M9", "nura"], "M12", [
          "M10",
          "nura",
        ]),
      }).map((e) => e.code),
    ).toContain("DIRECTION"));
  it("accepts exactly 100 and rejects 101", () => {
    expect(
      evaluate(plan("M2", "M6", "M14", ["M7", "nura"], ["M1", "nura"])).cost,
    ).toBe(100);
    expect(
      validate({
        decisions: plan("M2", "M6", "M14", ["M7", "nura"], ["M1", "nura"]),
      }),
    ).toEqual([]);
    expect(
      validate({
        decisions: plan(
          ["M3", "nura"],
          ["M5", "saryarka"],
          ["M8", "nura"],
          "M12",
          ["M10", "nura"],
        ),
      }).map((e) => e.code),
    ).toContain("BUDGET");
  });
  it("rejects unknown IDs, wrong scope and client coefficients", () => {
    for (const input of [
      { decisions: plan("FAKE", "M2", "M6", "M12", "M14") },
      { decisions: plan("M1", "M2", "M6", "M12", "M14") },
      { decisions: plan(["M2", "nura"], "M1", "M6", "M12", "M14") },
      { decisions: example, cost: 0 },
      { decisions: [{ measure_id: "M1", district_id: "city" }] },
    ])
      expect(evaluateScenario(input).valid).toBe(false);
  });
  it("enforces global transport conflict", () =>
    expect(
      validate({
        decisions: plan(
          ["M1", "nura"],
          ["M3", "esil"],
          "M12",
          ["M9", "nura"],
          ["M10", "nura"],
        ),
      }).map((e) => e.code),
    ).toContain("CONFLICT"));
  it.each([
    ["M4", "M7"],
    ["M5", "M13"],
  ])("checks local conflict %s/%s only in same district", (a, b) => {
    const others = plan("M12", ["M9", "almaty"], ["M11", "almaty"]);
    expect(
      validate({
        decisions: [...plan([a, "nura"], [b, "nura"]), ...others],
      }).map((e) => e.code),
    ).toContain("CONFLICT");
    expect(
      validate({
        decisions: [...plan([a, "nura"], [b, "esil"]), ...others],
      }).map((e) => e.code),
    ).not.toContain("CONFLICT");
  });
  it("charges city measures once and applies to every district", () => {
    const r = evaluate(example);
    for (const d of model.districts)
      expect(r.indicators[d.id].C2 - d.indicators.C2).toBe(4.375);
    expect(r.cost).toBe(95);
  });
  it.each([
    {
      a: "M1",
      b: "M2",
      metric: "T1",
      others: plan(["M9", "nura"], ["M10", "nura"], "M12"),
    },
    {
      a: "M10",
      b: "M12",
      metric: "B1",
      others: plan(["M9", "nura"], ["M4", "esil"], "M14"),
    },
    {
      a: "M5",
      b: "M6",
      metric: "E2",
      others: plan(["M9", "nura"], ["M10", "nura"], "M12"),
    },
  ])("keeps $a/$b synergy fixed and local", ({ a, b, metric, others }) => {
    const r = evaluate([...plan([a, "nura"], b), ...others]);
    const evidence = r.evidence[`${r.id}:nura:${metric}`];
    expect(
      evidence.contributions.find((c) => c.kind === "synergy")?.delta,
    ).toBe(2);
    expect(
      Object.values(r.evidence)
        .filter((e) => e.districtId !== "nura")
        .flatMap((e) => e.contributions)
        .some((c) => c.kind === "synergy"),
    ).toBe(false);
  });
  it("retains the negative M11 effect", () => {
    const r = evaluate(
      plan(["M11", "nura"], ["M9", "nura"], ["M10", "nura"], "M12", [
        "M4",
        "esil",
      ]),
    );
    expect(r.indicators.nura.T1).toBe(53.25);
  });
  it("is independent of order and leaves data unchanged", () => {
    const initial = JSON.stringify(model);
    expect(evaluate(example)).toEqual(evaluate([...example].reverse()));
    expect(JSON.stringify(model)).toBe(initial);
  });
  it("uses a strictly-below critical threshold", () => {
    const matrix = structuredClone(computeBaseline().indicators);
    matrix.nura.S1 = 40;
    matrix.nura.S2 = 40;
    expect(aggregate(matrix).criticalPairs).toHaveLength(0);
    matrix.nura.S2 = 39.999;
    expect(aggregate(matrix).criticalPairs).toHaveLength(1);
  });
  it("reconciles the full unrounded effect ledger", () => {
    for (const e of Object.values(evaluate(example).evidence)) {
      expect(e.beforeClip).toBeCloseTo(
        e.initial + e.contributions.reduce((s, c) => s + c.delta, 0),
        12,
      );
      expect(e.value).toBe(Math.min(100, Math.max(0, e.beforeClip)));
    }
  });
});
describe("team-authored winter experiment", () => {
  it("none is identical to the official result", () =>
    expect(runStress({ decisions: example }, "none")).toEqual(
      evaluateScenario({ decisions: example }),
    ));
  it("applies fixed shocks once without changing official results", () => {
    const official = evaluate(example),
      before = JSON.stringify(official);
    const a = runStress({ decisions: example }, "winter_demo"),
      b = runStress({ decisions: example }, "winter_demo");
    expect(a).toEqual(b);
    expect(JSON.stringify(official)).toBe(before);
    if (!a.valid) throw new Error("invalid");
    for (const d of model.districts) {
      expect(a.result.indicators[d.id].T1).toBe(
        official.indicators[d.id].T1 - 4,
      );
      expect(a.result.indicators[d.id].C1).toBe(
        official.indicators[d.id].C1 - 8,
      );
    }
    expect(a.result.kind).toBe("experimental");
  });
  it("rejects invalid plans and unknown events", () => {
    expect(runStress({ decisions: [] }, "winter_demo")).toMatchObject({
      valid: false,
      score: null,
    });
    expect(runStress({ decisions: example }, "fake").valid).toBe(false);
  });
});
