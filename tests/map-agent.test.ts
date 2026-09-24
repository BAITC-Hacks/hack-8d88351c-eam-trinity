import { describe, it, expect } from "vitest";
import { model, snapshotKey, type Result } from "../src/lib/model/engine";
import { createContext, executeTool } from "../src/lib/ai/tools";
import {
  requestsMapDisplay,
  requestedMapMode,
  requestedMapTarget,
  resolveMapCommand,
  type MapCommand,
} from "../src/lib/map/commands";
import {
  runAgent,
  type AgentEvent,
  type ModelTransport,
} from "../src/lib/ai/runner";
const decisions = model.source_example.decisions;
const input = decisions.map((d) => ({
  ...d,
  district_id: d.district_id ?? null,
}));
function fixture() {
  const ctx = createContext(decisions, true);
  executeTool("evaluate_scenario", { decisions: input }, ctx);
  executeTool(
    "run_stress_test",
    { decisions: input, event_id: "winter_demo" },
    ctx,
  );
  const [official, winter] = [...ctx.results.values()];
  for (const r of [official, winter])
    executeTool(
      "get_evidence",
      {
        result_id: r.id,
        district_id: r.kind === "experimental" ? "saryarka" : "nura",
        metric_id: r.kind === "experimental" ? "C1" : "B1",
      },
      ctx,
    );
  return { ctx, official, winter, eid: `${winter.id}:saryarka:C1` };
}
const allowed = () => ({ allowed: true, seen: new Set<string>() });
describe("bounded map evidence command", () => {
  it("uses the domain dictionary for explicit metric/district names instead of stale UI focus", () => {
    expect(
      requestedMapTarget("Открой безопасность улиц в Нуре после решений"),
    ).toEqual({ district: "nura", metric: "B1" });
    expect(requestedMapTarget("Покажи изменения ЖКХ в Сарыарке")).toEqual({
      district: "saryarka",
      metric: "C1",
    });
    expect(requestedMapTarget("Открой C1 в Сарайшық")).toEqual({
      district: null,
      metric: "C1",
    });
    const { ctx, eid } = fixture();
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, {
        ...allowed(),
        metric: "B1",
      }),
    ).toThrow("MAP_TARGET_MISMATCH");
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, {
        ...allowed(),
        district: "nura",
      }),
    ).toThrow("MAP_TARGET_MISMATCH");
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, {
        ...allowed(),
        district: null,
      }),
    ).toThrow("MAP_NO_LEARNING_DATA");
  });
  it("binds explicit result mode independently of the enabled winter experiment", () => {
    expect(
      requestedMapMode("Открой на карте безопасность Нуры после решений"),
    ).toBe("official");
    expect(requestedMapMode("Покажи ЖКХ после зимнего события")).toBe(
      "experimental",
    );
    expect(requestedMapMode("Открой Есиль без зимы")).toBe("official");
    const { ctx, eid } = fixture();
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, {
        ...allowed(),
        mode: "official",
      }),
    ).toThrow("MAP_RESULT_MODE_MISMATCH");
  });

  it.each([
    "Покажи изменения ЖКХ в Сарыарке после зимнего события",
    "Открой на карте безопасность улиц в Нуре после решений",
    "Выдели район Алматы по качеству воздуха",
    "Можно показать Есиль?",
    "Show Nura utilities",
  ])("recognizes varied explicit display request: %s", (q) =>
    expect(requestsMapDisplay(q)).toBe(true),
  );
  it.each([
    "Объясни C1 в Сарыарке",
    "Проверь мой план",
    "Не показывай на карте, только объясни",
    "Не надо открывать карту",
    "Объясни, не перемещай карту",
    "Don't show Nura",
    "Объясни, что значит кнопка «Показать на карте»",
    "Не приближай карту, просто объясни команду zoom",
    "Как мне открыть карту?",
  ])("denies ordinary explanation/negation: %s", (q) =>
    expect(requestsMapDisplay(q)).toBe(false),
  );
  it("derives district, metric, result and feature from retrieved evidence only", () => {
    const { ctx, eid, official, winter } = fixture();
    const before = JSON.stringify([...ctx.results.values()]);
    const output = executeTool(
      "show_evidence_on_map",
      { evidence_id: eid },
      ctx,
      allowed(),
    ) as { status: string; command: MapCommand };
    expect(output.status).toBe("queued");
    expect(output.command).toMatchObject({
      evidenceId: eid,
      districtId: "saryarka",
      metricId: "C1",
      featureId: "relation/3486954",
      mode: "experimental",
      resultId: winter.id,
    });
    expect(
      resolveMapCommand(output.command, snapshotKey(decisions, true), [
        official,
        winter,
      ])?.evidence.value,
    ).toBe(39.5);
    expect(JSON.stringify([...ctx.results.values()])).toBe(before);
    expect(() =>
      executeTool(
        "show_evidence_on_map",
        { evidence_id: eid, coordinates: [0, 0] },
        ctx,
        allowed(),
      ),
    ).toThrow();
  });
  it("rejects unknown, foreign, unretrieved and old-snapshot evidence", () => {
    const { ctx, eid, winter } = fixture();
    for (const id of ["foreign", `${winter.id}:esil:C1`])
      expect(() =>
        executeTool(
          "show_evidence_on_map",
          { evidence_id: id },
          ctx,
          allowed(),
        ),
      ).toThrow("UNVERIFIED_EVIDENCE");
    expect(() =>
      executeTool(
        "show_evidence_on_map",
        { evidence_id: eid },
        createContext(decisions, true),
        allowed(),
      ),
    ).toThrow("UNVERIFIED_EVIDENCE");
    ctx.decisions = [];
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, allowed()),
    ).toThrow("SNAPSHOT_MISMATCH");
  });
  it("requires current intent and deduplicates within a question, not across follow-ups", () => {
    const { ctx, eid } = fixture(),
      action = allowed();
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx),
    ).toThrow("MAP_ACTION_NOT_REQUESTED");
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, {
        ...action,
        allowed: false,
      }),
    ).toThrow("MAP_ACTION_NOT_REQUESTED");
    expect(
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, action),
    ).toHaveProperty("status", "queued");
    expect(
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, action),
    ).toEqual({ status: "already_queued" });
    expect(
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, allowed()),
    ).toHaveProperty("status", "queued");
  });
  it("denies incomplete calculations, disabled winter and forged browser commands", () => {
    const { ctx, eid, official, winter } = fixture();
    const { command } = executeTool(
      "show_evidence_on_map",
      { evidence_id: eid },
      ctx,
      allowed(),
    ) as { command: MapCommand };
    const key = snapshotKey(decisions, true),
      results: Result[] = [official, winter];
    for (const patch of [
      { snapshotKey: "old" },
      { districtId: "nura" },
      { metricId: "T1" },
      { mode: "official" },
      { featureId: "relation/19733918" },
      { resultId: official.id },
      { coordinates: [0, 0] },
    ])
      expect(
        resolveMapCommand({ ...command, ...patch }, key, results),
      ).toBeNull();
    expect(resolveMapCommand(command, key, [])).toBeNull();
    ctx.winter = false;
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, allowed()),
    ).toThrow("EVENT_NOT_SELECTED");
    ctx.winter = true;
    ctx.executed.clear();
    expect(() =>
      executeTool("show_evidence_on_map", { evidence_id: eid }, ctx, allowed()),
    ).toThrow("INCOMPLETE_AUDIT");
  });
  it("emits one structured command only after executing the real tool, then verified numeric facts", async () => {
    const { ctx, eid, winter } = fixture();
    let turn = 0;
    const events: AgentEvent[] = [];
    const transport: ModelTransport = async () =>
      ++turn === 1
        ? {
            output: [1, 2].map((i) => ({
              type: "function_call" as const,
              name: "show_evidence_on_map",
              arguments: JSON.stringify({ evidence_id: eid }),
              call_id: `map${i}`,
            })),
            output_text: "",
          }
        : {
            output: [],
            output_text: JSON.stringify({
              intent: "explain",
              claims: [
                {
                  kind: "indicator",
                  result_id: winter.id,
                  evidence_id: eid,
                  measure_id: null,
                  field: null,
                  rule_id: null,
                },
              ],
            }),
          };
    const answer = await runAgent({
      ctx,
      question: "Покажи ЖКХ Сарыарки после зимы",
      model: "test-transport",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      transport,
      history: [],
    });
    expect(events.filter((e) => e.type === "map_command")).toHaveLength(1);
    expect(answer.facts[0].value).toContain("47,50 → 39,50");
  });
  it("does not accept a late model tool response after cancellation", async () => {
    const { ctx, eid } = fixture(),
      ctrl = new AbortController(),
      events: AgentEvent[] = [];
    const transport: ModelTransport = async () => {
      ctrl.abort();
      return {
        output: [
          {
            type: "function_call",
            name: "show_evidence_on_map",
            arguments: JSON.stringify({ evidence_id: eid }),
            call_id: "late",
          },
        ],
        output_text: "",
      };
    };
    await expect(
      runAgent({
        ctx,
        question: "Покажи зимний C1",
        model: "test-transport",
        signal: ctrl.signal,
        emit: (e) => events.push(e),
        transport,
        history: [],
      }),
    ).rejects.toThrow();
    expect(events).toHaveLength(0);
  });
});
