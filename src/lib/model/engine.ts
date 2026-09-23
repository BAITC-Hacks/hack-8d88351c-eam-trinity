import { z } from "zod";
import raw from "../../../hackalem_model.json";
import eventsRaw from "../../../stress_events.json";

export const metricIds = [
  "T1",
  "T2",
  "E1",
  "E2",
  "S1",
  "S2",
  "B1",
  "B2",
  "C1",
  "C2",
] as const;
export type MetricId = (typeof metricIds)[number];
export const districtIds = [
  "esil",
  "almaty",
  "saryarka",
  "baikonur",
  "nura",
] as const;
export type DistrictId = (typeof districtIds)[number];
const indicatorSchema = z.object(
  Object.fromEntries(
    metricIds.map((k) => [k, z.number().min(0).max(100)]),
  ) as Record<MetricId, z.ZodNumber>,
);
const sourceSchema = z.object({
  schema_version: z.string(),
  constants: z.object({
    budget: z.number(),
    required_decisions: z.number(),
    max_per_direction: z.number(),
    horizon_quarters: z.number(),
    critical_threshold_strictly_below: z.number(),
    critical_penalty_per_pair: z.number(),
    city_mean_weight: z.number(),
    minimum_district_weight: z.number(),
  }),
  metrics: z
    .array(
      z.object({
        id: z.enum(metricIds),
        name: z.string(),
        direction: z.string(),
        weight: z.number(),
        source_definition: z.string(),
      }),
    )
    .length(10),
  districts: z
    .array(
      z.object({
        id: z.enum(districtIds),
        name: z.string(),
        population_share: z.number(),
        indicators: indicatorSchema,
      }),
    )
    .length(5),
  measures: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        direction: z.string(),
        scope: z.enum(["district", "city"]),
        cost: z.number(),
        lag_quarters: z.number(),
        effects: z.partialRecord(z.enum(metricIds), z.number()),
      }),
    )
    .length(14),
  synergies: z.array(
    z.object({
      measure_ids: z.array(z.string()),
      target_district_of: z.string(),
      effects: z.record(z.string(), z.number()),
    }),
  ),
  conflicts: z.array(
    z.object({
      measure_ids: z.array(z.string()),
      condition: z.enum(["always", "same_district"]),
    }),
  ),
  source_example: z.object({
    decisions: z.array(
      z.object({
        measure_id: z.string(),
        district_id: z.enum(districtIds).optional(),
      }),
    ),
    source_cost: z.number(),
  }),
});
// Source files are validated once; client-supplied coefficients never enter this model.
export const model = sourceSchema.parse(raw);
export const events = z
  .object({
    events: z.array(
      z.object({
        id: z.enum(["none", "winter_demo"]),
        version: z.string(),
        name: z.string(),
        deltas: z.array(
          z.object({
            scope: z.literal("city"),
            metric_id: z.enum(metricIds),
            delta: z.number(),
          }),
        ),
      }),
    ),
  })
  .parse(eventsRaw).events;
export const decisionSchema = z
  .object({
    measure_id: z.string().max(8),
    district_id: z.enum(districtIds).optional(),
  })
  .strict();
export const scenarioSchema = z
  .object({ decisions: z.array(decisionSchema).max(14) })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export type Issue = { code: string; message: string; measure_ids?: string[] };
export type Matrix = Record<DistrictId, Record<MetricId, number>>;
export type Contribution = {
  measureId: string;
  name: string;
  full: number;
  factor: number;
  delta: number;
  kind: "measure" | "synergy" | "event";
};
export type Evidence = {
  id: string;
  districtId: DistrictId;
  metricId: MetricId;
  initial: number;
  contributions: Contribution[];
  beforeClip: number;
  value: number;
};
export type Result = {
  id: string;
  kind: "baseline" | "official" | "experimental";
  modelVersion: string;
  eventId: "none" | "winter_demo";
  eventVersion: string;
  decisions: Decision[];
  indicators: Matrix;
  districtTotals: Record<DistrictId, number>;
  cityMean: number;
  minimum: number;
  criticalPairs: { districtId: DistrictId; metricId: MetricId }[];
  score: number;
  cost: number;
  remaining: number;
  evidence: Record<string, Evidence>;
};
export type Evaluation =
  | { valid: false; score: null; errors: Issue[] }
  | { valid: true; result: Result };
export const normalize = (decisions: Decision[]) =>
  decisions
    .map((d) => ({ ...d }))
    .sort((a, b) => a.measure_id.localeCompare(b.measure_id));
export function snapshotKey(decisions: Decision[], winter: boolean) {
  return JSON.stringify([
    normalize(decisions),
    winter,
    model.schema_version,
    events[1].version,
  ]);
}
export const format = (v: number) =>
  v.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const formatExact = (v: number) =>
  v.toLocaleString("ru-RU", { maximumFractionDigits: 8 });
const clip = (n: number) => Math.min(100, Math.max(0, n));
export function resolveIndicator(
  initial: number,
  contributions: Pick<Contribution, "delta">[],
) {
  const beforeClip =
    initial + contributions.reduce((sum, c) => sum + c.delta, 0);
  return { beforeClip, value: clip(beforeClip) };
}
export function validate(input: unknown): Issue[] {
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success)
    return [
      {
        code: "INPUT",
        message:
          "Некорректный формат: неизвестный район, лишнее поле или неверный тип данных.",
      },
    ];
  const { decisions } = parsed.data;
  const errors: Issue[] = [];
  if (decisions.length !== 5)
    errors.push({
      code: "COUNT",
      message: `Выбрано ${decisions.length} из 5 мероприятий. Нужно ровно пять.`,
    });
  const seen = new Set<string>();
  const directions: Record<string, number> = {};
  let cost = 0;
  for (const d of decisions) {
    const m = model.measures.find((m) => m.id === d.measure_id);
    if (!m) {
      errors.push({
        code: "UNKNOWN",
        message: `Неизвестное мероприятие ${d.measure_id}.`,
      });
      continue;
    }
    if (seen.has(m.id))
      errors.push({
        code: "DUPLICATE",
        message: `${m.id}: мероприятие уже выбрано.`,
        measure_ids: [m.id],
      });
    seen.add(m.id);
    cost += m.cost;
    directions[m.direction] = (directions[m.direction] ?? 0) + 1;
    if (m.scope === "district" && !d.district_id)
      errors.push({
        code: "DISTRICT",
        message: `${m.id}: выберите район.`,
        measure_ids: [m.id],
      });
    if (m.scope === "city" && d.district_id)
      errors.push({
        code: "SCOPE",
        message: `${m.id}: городская мера не принимает район.`,
        measure_ids: [m.id],
      });
  }
  if (cost > 100)
    errors.push({
      code: "BUDGET",
      message: `Стоимость ${cost}: превышение бюджета на ${cost - 100}.`,
    });
  for (const [direction, count] of Object.entries(directions))
    if (count > 2)
      errors.push({
        code: "DIRECTION",
        message: `${direction}: допускается не больше двух мер.`,
      });
  for (const c of model.conflicts) {
    const a = decisions.find((d) => d.measure_id === c.measure_ids[0]),
      b = decisions.find((d) => d.measure_id === c.measure_ids[1]);
    if (a && b && (c.condition === "always" || a.district_id === b.district_id))
      errors.push({
        code: "CONFLICT",
        message: `${c.measure_ids.join(" и ")} несовместимы${c.condition === "same_district" ? " в одном районе" : ""}.`,
        measure_ids: c.measure_ids,
      });
  }
  return errors;
}
export function aggregate(indicators: Matrix) {
  const districtTotals = Object.fromEntries(
    model.districts.map((d) => [
      d.id,
      model.metrics.reduce(
        (sum, m) => sum + m.weight * indicators[d.id][m.id],
        0,
      ),
    ]),
  ) as Record<DistrictId, number>;
  const cityMean = model.districts.reduce(
    (sum, d) => sum + d.population_share * districtTotals[d.id],
    0,
  );
  const minimum = Math.min(...Object.values(districtTotals));
  const criticalPairs = model.districts.flatMap((d) =>
    metricIds
      .filter((k) => indicators[d.id][k] < 40)
      .map((metricId) => ({ districtId: d.id, metricId })),
  );
  return {
    districtTotals,
    cityMean,
    minimum,
    criticalPairs,
    score: 0.7 * cityMean + 0.3 * minimum - criticalPairs.length,
  };
}
function calculate(
  decisions: Decision[],
  kind: "baseline" | "official",
): Result {
  const sorted = normalize(decisions);
  const id = `${model.schema_version}:${kind}:${sorted.map((d) => `${d.measure_id}@${d.district_id ?? "all"}`).join(",")}`;
  const indicators = {} as Matrix;
  const evidence: Record<string, Evidence> = {};
  for (const d of model.districts) {
    indicators[d.id] = { ...d.indicators };
    for (const k of metricIds) {
      const contributions: Contribution[] = [];
      for (const decision of sorted) {
        const m = model.measures.find((m) => m.id === decision.measure_id)!;
        if (m.scope !== "city" && decision.district_id !== d.id) continue;
        const full = m.effects[k];
        if (full === undefined) continue;
        const factor = (8 - m.lag_quarters) / 8;
        contributions.push({
          measureId: m.id,
          name: m.name,
          full,
          factor,
          delta: full * factor,
          kind: "measure",
        });
      }
      for (const s of model.synergies) {
        if (
          !s.measure_ids.every((id) => sorted.some((x) => x.measure_id === id))
        )
          continue;
        if (
          sorted.find((x) => x.measure_id === s.target_district_of)
            ?.district_id !== d.id
        )
          continue;
        const delta = s.effects[k];
        if (delta !== undefined)
          contributions.push({
            measureId: s.measure_ids.join("+"),
            name: "Синергия",
            full: delta,
            factor: 1,
            delta,
            kind: "synergy",
          });
      }
      const { beforeClip, value } = resolveIndicator(
        d.indicators[k],
        contributions,
      );
      indicators[d.id][k] = value;
      const eid = `${id}:${d.id}:${k}`;
      evidence[eid] = {
        id: eid,
        districtId: d.id,
        metricId: k,
        initial: d.indicators[k],
        contributions,
        beforeClip,
        value,
      };
    }
  }
  const cost = sorted.reduce(
    (sum, d) => sum + model.measures.find((m) => m.id === d.measure_id)!.cost,
    0,
  );
  return {
    id,
    kind,
    modelVersion: model.schema_version,
    eventId: "none",
    eventVersion: "1.0",
    decisions: sorted,
    indicators,
    evidence,
    cost,
    remaining: 100 - cost,
    ...aggregate(indicators),
  };
}
export function computeBaseline() {
  return calculate([], "baseline");
}
export function evaluateScenario(input: unknown): Evaluation {
  const errors = validate(input);
  if (errors.length) return { valid: false, score: null, errors };
  return {
    valid: true,
    result: calculate(scenarioSchema.parse(input).decisions, "official"),
  };
}
export function runStress(input: unknown, eventId: string): Evaluation {
  const official = evaluateScenario(input);
  if (!official.valid) return official;
  const event = events.find((e) => e.id === eventId);
  if (!event)
    return {
      valid: false,
      score: null,
      errors: [{ code: "EVENT", message: "Неизвестное учебное событие." }],
    };
  if (event.id === "none") return official;
  const base = official.result;
  const id = `${base.id}:${event.id}@${event.version}`;
  const indicators = structuredClone(base.indicators);
  const evidence: Record<string, Evidence> = {};
  for (const d of model.districts)
    for (const k of metricIds) {
      const initial = base.indicators[d.id][k];
      const contributions = event.deltas
        .filter((s) => s.metric_id === k)
        .map((s) => ({
          measureId: event.id,
          name: event.name,
          kind: "event" as const,
          full: s.delta,
          factor: 1,
          delta: s.delta,
        }));
      const { beforeClip, value } = resolveIndicator(initial, contributions);
      indicators[d.id][k] = value;
      const eid = `${id}:${d.id}:${k}`;
      evidence[eid] = {
        id: eid,
        districtId: d.id,
        metricId: k,
        initial,
        contributions,
        beforeClip,
        value,
      };
    }
  return {
    valid: true,
    result: {
      ...base,
      id,
      kind: "experimental",
      eventId: event.id,
      eventVersion: event.version,
      indicators,
      evidence,
      ...aggregate(indicators),
    },
  };
}
