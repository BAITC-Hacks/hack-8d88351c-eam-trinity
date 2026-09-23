import { describe, it, expect } from "vitest";
import { model } from "../src/lib/model/engine";
import { createContext, executeTool } from "../src/lib/ai/tools";
import { verifyAnswer } from "../src/lib/ai/explanation";
import {
  runAgent,
  type ModelTransport,
  type AgentEvent,
} from "../src/lib/ai/runner";
const decisions = model.source_example.decisions;
const toolDecisions = decisions.map((d) => ({
  ...d,
  district_id: d.district_id ?? null,
}));
const empty = {
  result_id: null,
  evidence_id: null,
  measure_id: null,
  field: null,
  rule_id: null,
};
function audited() {
  const ctx = createContext(decisions, true);
  executeTool("evaluate_scenario", { decisions: toolDecisions }, ctx);
  executeTool(
    "run_stress_test",
    { decisions: toolDecisions, event_id: "winter_demo" },
    ctx,
  );
  return ctx;
}
describe("real tool implementations and verified explanations", () => {
  it("preserves exact lag factors in numerical explanations", () => {
    const ctx = audited(),
      r = [...ctx.results.values()][0];
    executeTool(
      "get_evidence",
      { result_id: r.id, district_id: "saryarka", metric_id: "E2" },
      ctx,
    );
    const answer = verifyAnswer(
      {
        intent: "explain",
        claims: [
          {
            ...empty,
            kind: "effect",
            result_id: r.id,
            evidence_id: `${r.id}:saryarka:E2`,
            measure_id: "M5",
          },
        ],
      },
      ctx,
    );
    expect(answer.facts[0].value).toBe("14 × 0,625 = +8,75 п.");
  });
  it("cannot bypass numeric verification by labelling a claim as a rule", () => {
    const ctx = createContext(decisions, true);
    expect(() =>
      verifyAnswer(
        {
          intent: "rules",
          claims: [
            { ...empty, kind: "aggregate", field: "score", result_id: "fake" },
          ],
        },
        ctx,
      ),
    ).toThrow("INVALID_RULE_CLAIM");
    expect(() =>
      verifyAnswer(
        {
          intent: "outside_model",
          claims: [
            { ...empty, kind: "aggregate", field: "score", result_id: "fake" },
          ],
        },
        ctx,
      ),
    ).toThrow("OUTSIDE_MODEL_CLAIMS");
  });
  it("binds all calculations to the user snapshot", () => {
    const ctx = createContext(decisions, true);
    const changed = structuredClone(toolDecisions);
    changed[0].district_id = "esil";
    expect(() =>
      executeTool("evaluate_scenario", { decisions: changed }, ctx),
    ).toThrow("SNAPSHOT_MISMATCH");
    expect(ctx.results.size).toBe(0);
  });
  it("rejects foreign results, unknown tools, extra coefficients and deselected winter", () => {
    const ctx = createContext(decisions, false);
    expect(() =>
      executeTool(
        "get_evidence",
        { result_id: "foreign", district_id: "nura", metric_id: "B1" },
        ctx,
      ),
    ).toThrow("UNKNOWN_RESULT");
    expect(() => executeTool("shell", {}, ctx)).toThrow("UNKNOWN_TOOL");
    expect(() =>
      executeTool(
        "evaluate_scenario",
        { decisions: toolDecisions, cost: 1 },
        ctx,
      ),
    ).toThrow();
    expect(() =>
      executeTool(
        "run_stress_test",
        { decisions: toolDecisions, event_id: "winter_demo" },
        ctx,
      ),
    ).toThrow("EVENT_NOT_SELECTED");
  });
  it("requires both executed tools for a completed winter audit", () => {
    const ctx = createContext(decisions, true);
    executeTool("evaluate_scenario", { decisions: toolDecisions }, ctx);
    const id = [...ctx.results.keys()][0];
    expect(() =>
      verifyAnswer(
        {
          intent: "audit",
          claims: [
            { ...empty, kind: "aggregate", result_id: id, field: "score" },
          ],
        },
        ctx,
      ),
    ).toThrow("INCOMPLETE_AUDIT");
  });
  it("requires evidence to have actually been retrieved", () => {
    const ctx = audited(),
      r = [...ctx.results.values()][0];
    expect(() =>
      verifyAnswer(
        {
          intent: "explain",
          claims: [
            {
              ...empty,
              kind: "indicator",
              result_id: r.id,
              evidence_id: `${r.id}:nura:B1`,
            },
          ],
        },
        ctx,
      ),
    ).toThrow("UNVERIFIED_EVIDENCE");
  });
  it("constructs exact numerical assertions from evidence, including synergy", () => {
    const ctx = audited(),
      r = [...ctx.results.values()][0];
    executeTool(
      "get_evidence",
      { result_id: r.id, district_id: "nura", metric_id: "B1" },
      ctx,
    );
    const answer = verifyAnswer(
      {
        intent: "explain",
        claims: [
          {
            ...empty,
            kind: "indicator",
            result_id: r.id,
            evidence_id: `${r.id}:nura:B1`,
          },
          {
            ...empty,
            kind: "effect",
            result_id: r.id,
            evidence_id: `${r.id}:nura:B1`,
            measure_id: "M10+M12",
          },
        ],
      },
      ctx,
    );
    expect(answer.facts[0].value).toBe("55,00 → 67,50 (+12,50 п.)");
    expect(answer.facts[1].value).toContain("+2,00");
  });
  it("rejects supplied numbers, unsupported effects, unknown and cross-result evidence", () => {
    const ctx = audited(),
      [a, b] = [...ctx.results.values()];
    executeTool(
      "get_evidence",
      { result_id: a.id, district_id: "nura", metric_id: "B1" },
      ctx,
    );
    const claim = {
      ...empty,
      kind: "indicator",
      result_id: a.id,
      evidence_id: `${a.id}:nura:B1`,
    };
    expect(() =>
      verifyAnswer(
        { intent: "explain", claims: [{ ...claim, value: 999 }] },
        ctx,
      ),
    ).toThrow();
    expect(() =>
      verifyAnswer(
        { intent: "explain", claims: [{ ...claim, result_id: b.id }] },
        ctx,
      ),
    ).toThrow("UNVERIFIED_EVIDENCE");
    expect(() =>
      verifyAnswer(
        {
          intent: "explain",
          claims: [{ ...claim, kind: "effect", measure_id: "M14" }],
        },
        ctx,
      ),
    ).toThrow("UNVERIFIED_EFFECT");
  });
  it("does not treat references from another run as current evidence", () => {
    const ctx = audited(),
      other = createContext(decisions, true),
      r = [...ctx.results.values()][0];
    executeTool(
      "get_evidence",
      { result_id: r.id, district_id: "nura", metric_id: "B1" },
      ctx,
    );
    expect(() =>
      executeTool(
        "get_evidence",
        { result_id: r.id, district_id: "nura", metric_id: "B1" },
        other,
      ),
    ).toThrow("UNKNOWN_RESULT");
  });
  it("returns model rules only after actual retrieval", () => {
    const ctx = createContext(decisions, false);
    const answer = {
      intent: "rules",
      claims: [{ ...empty, kind: "rule", rule_id: "budget" }],
    };
    expect(() => verifyAnswer(answer, ctx)).toThrow("UNVERIFIED_RULE");
    executeTool("get_model_rules", {}, ctx);
    expect(verifyAnswer(answer, ctx).facts[0].value).toContain("100");
  });
});
describe("agent orchestration (test transport, not a live provider)", () => {
  it("executes multiple tool rounds, passes outputs back, then validates a structured answer", async () => {
    const ctx = createContext(decisions, true);
    let turn = 0;
    const events: AgentEvent[] = [];
    const transport: ModelTransport = async (params) => {
      turn++;
      const input = JSON.stringify(params.input);
      if (turn === 1)
        return {
          output: [
            {
              type: "function_call",
              name: "evaluate_scenario",
              arguments: JSON.stringify({ decisions: toolDecisions }),
              call_id: "a",
            },
            {
              type: "function_call",
              name: "run_stress_test",
              arguments: JSON.stringify({
                decisions: toolDecisions,
                event_id: "winter_demo",
              }),
              call_id: "b",
            },
          ],
          output_text: "",
        };
      const result = [...ctx.results.values()][0];
      if (turn === 2) {
        expect(input).toContain("function_call_output");
        const outputs = Array.isArray(params.input)
          ? params.input.filter(
              (item) =>
                typeof item === "object" &&
                item.type === "function_call_output",
            )
          : [];
        const official = outputs.find(
          (item) => "call_id" in item && item.call_id === "a",
        );
        expect(
          JSON.parse(
            String(official && "output" in official ? official.output : "{}"),
          ).score,
        ).toBeCloseTo(56.54307, 8);
        return {
          output: [
            {
              type: "function_call",
              name: "get_evidence",
              arguments: JSON.stringify({
                result_id: result.id,
                district_id: "nura",
                metric_id: "B1",
              }),
              call_id: "c",
            },
          ],
          output_text: "",
        };
      }
      expect(input).toContain("M10+M12");
      return {
        output: [],
        output_text: JSON.stringify({
          intent: "explain",
          claims: [
            {
              ...empty,
              kind: "indicator",
              result_id: result.id,
              evidence_id: `${result.id}:nura:B1`,
            },
          ],
        }),
      };
    };
    const answer = await runAgent({
      ctx,
      question: "Почему изменился B1?",
      model: "test-only",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      transport,
      history: [],
    });
    expect(turn).toBe(3);
    expect(answer.facts[0].value).toContain("67,50");
    expect(
      events.filter((e) => e.type === "tool" && e.status === "completed"),
    ).toHaveLength(3);
    expect(events.filter((e) => e.type === "result")).toHaveLength(2);
  });
  it("stops after bounded invalid answers instead of inventing completion", async () => {
    let count = 0;
    const transport: ModelTransport = async () => {
      count++;
      return { output: [], output_text: '{"wrong":true}' };
    };
    await expect(
      runAgent({
        ctx: createContext(decisions, true),
        question: "Проверь",
        model: "test-only",
        signal: new AbortController().signal,
        emit: () => {},
        transport,
        history: [],
      }),
    ).rejects.toThrow("TURN_LIMIT");
    expect(count).toBe(6);
  });
  it("honors cancellation before contacting the provider", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let contacted = false;
    const transport: ModelTransport = async () => {
      contacted = true;
      return { output: [], output_text: "" };
    };
    await expect(
      runAgent({
        ctx: createContext(decisions, true),
        question: "Проверь",
        model: "test-only",
        signal: ctrl.signal,
        emit: () => {},
        transport,
        history: [],
      }),
    ).rejects.toThrow();
    expect(contacted).toBe(false);
  });
});
