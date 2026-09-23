import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import {
  model,
  events,
  metricIds,
  districtIds,
  normalize,
  evaluateScenario,
  runStress,
  type Decision,
  type Result,
  type Evidence,
} from "../model/engine";

export const rules = {
  budget: "Бюджет — 100 условных единиц. Остаток не даёт бонуса.",
  count:
    "Нужны ровно пять различных мероприятий; каждое выбирается только один раз.",
  directions:
    "Не более двух мер одного направления. Все пять направлений доступны; минимум три будут затронуты.",
  scope:
    "Районная мера действует в одном выбранном районе. Городская действует во всех районах и оплачивается один раз.",
  conflicts:
    "M1 и M3 несовместимы всегда. M4/M7 и M5/M13 несовместимы в одном районе.",
  formula:
    "Эффект умножается на (8 − лаг) / 8. Синергии фиксированы. После суммы показатель ограничивается диапазоном [0, 100]. Score = 0,7 × среднее города + 0,3 × минимум района − число пар ниже 40.",
  winter:
    "Учебная зима — допущение команды: T1 −4 и C1 −8 во всех районах после официального расчёта, однократно. Это не прогноз.",
  interpretation:
    "Данные синтетические. Результат относится только к выбранным условиям; он не подтверждает реальную безопасность и не определяет лучшую городскую политику.",
} as const;
export const ruleIds = Object.keys(rules) as [
  keyof typeof rules,
  ...(keyof typeof rules)[],
];
const measureIds = model.measures.map((m) => m.id) as [string, ...string[]];
const toolDecisions = z
  .array(
    z
      .object({
        measure_id: z.enum(measureIds),
        district_id: z.enum(districtIds).nullable(),
      })
      .strict(),
  )
  .length(5);
export const toolSchemas = {
  get_model_rules: z.object({}).strict(),
  evaluate_scenario: z.object({ decisions: toolDecisions }).strict(),
  run_stress_test: z
    .object({
      decisions: toolDecisions,
      event_id: z.enum(["none", "winter_demo"]),
    })
    .strict(),
  get_evidence: z
    .object({
      result_id: z.string(),
      district_id: z.enum(districtIds),
      metric_id: z.enum(metricIds),
    })
    .strict(),
};
const descriptions = {
  get_model_rules:
    "Получить правила учебной модели, определения и допустимые события.",
  evaluate_scenario:
    "Выполнить официальный расчёт текущего неизменного плана. Обязателен для аудита.",
  run_stress_test:
    "Выполнить учебный эксперимент текущего плана. Для аудита с зимой обязателен winter_demo.",
  get_evidence:
    "Раскрыть точную арифметику одного показателя из ранее рассчитанного результата этого запуска. Перед ссылкой на показатель в финальном ответе обязательно получить его evidence.",
};
export const tools: FunctionTool[] = Object.entries(toolSchemas).map(
  ([name, schema]) => ({
    type: "function",
    name,
    description: descriptions[name as keyof typeof descriptions],
    parameters: z.toJSONSchema(schema),
    strict: true,
  }),
);
export type ToolContext = {
  decisions: Decision[];
  winter: boolean;
  results: Map<string, Result>;
  evidence: Map<string, Evidence>;
  rulesRead: boolean;
  executed: Set<string>;
};
export function createContext(
  decisions: Decision[],
  winter: boolean,
): ToolContext {
  return {
    decisions: normalize(decisions),
    winter,
    results: new Map(),
    evidence: new Map(),
    rulesRead: false,
    executed: new Set(),
  };
}
function boundDecisions(value: unknown, ctx: ToolContext) {
  const list = toolDecisions.parse(value).map((d) => ({
    measure_id: d.measure_id,
    ...(d.district_id ? { district_id: d.district_id } : {}),
  }));
  if (JSON.stringify(normalize(list)) !== JSON.stringify(ctx.decisions))
    throw new Error("SNAPSHOT_MISMATCH");
  return list;
}
function resultFacts(r: Result) {
  return {
    result_id: r.id,
    kind: r.kind,
    event_id: r.eventId,
    event_version: r.eventVersion,
    cost: r.cost,
    score: r.score,
    cityMean: r.cityMean,
    minimum: r.minimum,
    criticalPairs: r.criticalPairs,
    districtTotals: r.districtTotals,
    indicators: r.indicators,
    evidence_available:
      "Call get_evidence with this result_id, district_id, metric_id to inspect changes before citing them.",
  };
}
export function executeTool(
  name: string,
  args: unknown,
  ctx: ToolContext,
): unknown {
  if (name === "get_model_rules") {
    toolSchemas.get_model_rules.parse(args);
    ctx.rulesRead = true;
    return {
      rules,
      metrics: model.metrics,
      districts: model.districts.map(({ id, name }) => ({ id, name })),
      events: events.filter((e) => ctx.winter || e.id === "none"),
      model_version: model.schema_version,
    };
  }
  if (name === "evaluate_scenario") {
    const parsed = toolSchemas.evaluate_scenario.parse(args);
    const result = evaluateScenario({
      decisions: boundDecisions(parsed.decisions, ctx),
    });
    if (!result.valid) return result;
    ctx.results.set(result.result.id, result.result);
    ctx.executed.add("evaluate_scenario");
    return resultFacts(result.result);
  }
  if (name === "run_stress_test") {
    const parsed = toolSchemas.run_stress_test.parse(args);
    if (parsed.event_id === "winter_demo" && !ctx.winter)
      throw new Error("EVENT_NOT_SELECTED");
    const result = runStress(
      { decisions: boundDecisions(parsed.decisions, ctx) },
      parsed.event_id,
    );
    if (!result.valid) return result;
    ctx.results.set(result.result.id, result.result);
    ctx.executed.add(`run_stress_test:${parsed.event_id}`);
    return resultFacts(result.result);
  }
  if (name === "get_evidence") {
    const parsed = toolSchemas.get_evidence.parse(args);
    const result = ctx.results.get(parsed.result_id);
    if (!result) throw new Error("UNKNOWN_RESULT");
    const evidence =
      result.evidence[`${result.id}:${parsed.district_id}:${parsed.metric_id}`];
    if (!evidence) throw new Error("UNKNOWN_EVIDENCE");
    ctx.evidence.set(evidence.id, evidence);
    return { ...evidence, kind: result.kind, eventId: result.eventId };
  }
  throw new Error("UNKNOWN_TOOL");
}
