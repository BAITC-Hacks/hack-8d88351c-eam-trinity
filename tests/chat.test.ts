import { describe, it, expect } from "vitest";
import { model } from "../src/lib/model/engine";
import { createContext, executeTool } from "../src/lib/ai/tools";
import { verifyAnswer } from "../src/lib/ai/explanation";
import { executionSteps, restoreTranscript } from "../src/lib/ai/chat";
const decisions = model.source_example.decisions.map((d) => ({
  ...d,
  district_id: d.district_id ?? null,
}));
describe("polished conversation grounded in execution", () => {
  it("renders no completed work for started or failed operations", () => {
    expect(
      executionSteps([
        { type: "tool", name: "evaluate_scenario", status: "started" },
      ]),
    ).toEqual([]);
    const failed = executionSteps([
      { type: "tool", name: "evaluate_scenario", status: "failed" },
    ]);
    expect(failed.every((s) => s.state !== "done")).toBe(true);
    expect(
      executionSteps([
        { type: "tool", name: "evaluate_scenario", status: "completed" },
      ]),
    ).toEqual([]);
  });
  it("distinguishes calculated, queued, applied and cancelled map actions", () => {
    const events = [
      { type: "result", resultKind: "official" },
      { type: "result", resultKind: "experimental" },
      { type: "tool", name: "get_evidence", status: "completed" },
      { type: "map_status", status: "requested" },
    ];
    expect(executionSteps(events).map((s) => s.label)).toEqual([
      "Проверен план",
      "Рассчитаны последствия",
      "Выполнен учебный стресс-тест",
      "Подтверждены вычисления",
      "Показываю результат на карте",
    ]);
    expect(
      executionSteps([...events, { type: "map_status", status: "applied" }]).at(
        -1,
      ),
    ).toEqual({ label: "Результат показан на карте", state: "done" });
    expect(
      executionSteps([
        ...events,
        { type: "map_status", status: "cancelled", text: "Отменено" },
      ]).at(-1),
    ).toEqual({ label: "Отменено", state: "notice" });
  });
  it("restores questions and answers as history, never resumes unfinished execution", () => {
    const restored = restoreTranscript(
      JSON.stringify([
        {
          id: "a",
          key: "snapshot",
          question: "Мой вопрос",
          events: [],
          status: "complete",
          answer: {
            summary: "Подтверждённый ответ",
            facts: [],
            limitations: [],
          },
        },
        {
          id: "b",
          key: "snapshot",
          question: "Уточнение",
          events: [],
          status: "running",
        },
      ]),
    );
    expect(restored).toHaveLength(2);
    expect(restored[0].answer?.summary).toBe("Подтверждённый ответ");
    expect(restored[0].restored).toBe(true);
    expect(restored[1].status).toBe("cancelled");
    expect(restoreTranscript("broken JSON")).toEqual([]);
    expect(restoreTranscript('[{"question":1}]')).toEqual([]);
  });
  it("constructs budget, risk and next checks only from evaluated results", () => {
    const ctx = createContext(model.source_example.decisions, true);
    executeTool("evaluate_scenario", { decisions }, ctx);
    executeTool("run_stress_test", { decisions, event_id: "winter_demo" }, ctx);
    const winter = [...ctx.results.values()].find(
      (r) => r.kind === "experimental",
    )!;
    executeTool(
      "get_evidence",
      { result_id: winter.id, district_id: "saryarka", metric_id: "C1" },
      ctx,
    );
    const answer = verifyAnswer(
      {
        intent: "explain",
        claims: [
          {
            kind: "indicator",
            result_id: winter.id,
            evidence_id: `${winter.id}:saryarka:C1`,
            measure_id: null,
            field: null,
            rule_id: null,
          },
        ],
      },
      ctx,
    );
    expect(answer.details?.budget?.value).toBe(
      "95,00 из 100,00 ед. Остаток: 5,00 ед. Ограничения плана соблюдены.",
    );
    expect(answer.details?.risks[0].value).toContain(
      `Значений ниже порога: ${winter.criticalPairs.length}`,
    );
    expect(answer.details?.risks[1].value).toBe("Снижение: 47,50 → 39,50.");
    expect(answer.details?.nextChecks).toHaveLength(3);
    expect(ctx.results.get(winter.id)?.indicators.saryarka.C1).toBe(39.5);
  });
  it("never presents an unperformed budget validation as complete", () => {
    const ctx = createContext(model.source_example.decisions, true);
    const answer = verifyAnswer({ intent: "outside_model", claims: [] }, ctx);
    expect(answer.details?.budget).toBeUndefined();
    expect(answer.details?.risks).toEqual([]);
    expect(answer.details?.nextChecks).toHaveLength(2);
  });
});
