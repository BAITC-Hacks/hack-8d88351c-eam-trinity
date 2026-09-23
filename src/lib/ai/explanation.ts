import { z } from "zod";
import { model, format, formatExact } from "../model/engine";
import { rules, ruleIds, type ToolContext } from "./tools";

// The model chooses verifiable claims, never literal values or unverified prose.
export const answerSchema = z
  .object({
    intent: z.enum(["audit", "explain", "rules", "outside_model"]),
    response: z.object({
      kind: z.enum(["audit", "indicator", "district", "comparison", "cause", "map", "risks", "next_checks"]),
      paragraphs: z.array(z.string().min(1).max(1400)).min(1).max(5),
    }).strict().optional(),
    claims: z
      .array(
        z
          .object({
            kind: z.enum(["indicator", "effect", "aggregate", "rule"]),
            result_id: z.string().nullable(),
            evidence_id: z.string().nullable(),
            measure_id: z.string().nullable(),
            field: z
              .enum(["score", "cityMean", "minimum", "criticalCount"])
              .nullable(),
            rule_id: z.enum(ruleIds).nullable(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type Fact = {
  label: string;
  value: string;
  evidenceId?: string;
  resultId?: string;
};
export type Answer = {
  summary: string;
  narrative?: string[];
  responseKind?: string;
  facts: Fact[];
  limitations: string[];
  details?: { budget?: Fact; risks: Fact[]; nextChecks: string[] };
};
const signed = (n: number) => `${n > 0 ? "+" : ""}${format(n)}`;
export function verifyAnswer(input: unknown, ctx: ToolContext): Answer {
  const parsed = answerSchema.parse(input);
  if (parsed.intent === "outside_model" && parsed.claims.length)
    throw new Error("OUTSIDE_MODEL_CLAIMS");
  if (parsed.intent === "rules" && parsed.claims.some((c) => c.kind !== "rule"))
    throw new Error("INVALID_RULE_CLAIM");
  if (parsed.intent !== "outside_model" && parsed.claims.length === 0)
    throw new Error("EMPTY_CLAIMS");
  if (
    parsed.intent !== "outside_model" &&
    parsed.intent !== "rules" &&
    (!ctx.executed.has("evaluate_scenario") ||
      (ctx.winter && !ctx.executed.has("run_stress_test:winter_demo")))
  )
    throw new Error("INCOMPLETE_AUDIT");
  const facts: Fact[] = parsed.claims.map((c) => {
    if (c.kind === "rule") {
      if (!ctx.rulesRead || !c.rule_id) throw new Error("UNVERIFIED_RULE");
      return { label: "Правило модели", value: rules[c.rule_id] };
    }
    if (!c.result_id) throw new Error("MISSING_RESULT");
    const result = ctx.results.get(c.result_id);
    if (!result) throw new Error("UNKNOWN_RESULT");
    const scope =
      result.kind === "experimental" ? "Учебная зима" : "По заданию";
    if (c.kind === "aggregate") {
      if (!c.field) throw new Error("MISSING_FIELD");
      const fields = {
        score: ["Итоговый Score", result.score],
        cityMean: ["Среднее города", result.cityMean],
        minimum: ["Минимум по районам", result.minimum],
        criticalCount: ["Значений ниже порога", result.criticalPairs.length],
      } as const;
      const [label, value] = fields[c.field];
      return {
        label: `${scope} · ${label}`,
        value: c.field === "criticalCount" ? String(value) : format(value),
        resultId: result.id,
      };
    }
    if (!c.evidence_id) throw new Error("MISSING_EVIDENCE");
    const e = ctx.evidence.get(c.evidence_id);
    if (!e || !result.evidence[e.id]) throw new Error("UNVERIFIED_EVIDENCE");
    const district = model.districts.find((d) => d.id === e.districtId)!,
      metric = model.metrics.find((m) => m.id === e.metricId)!;
    if (c.kind === "effect") {
      const contribution = e.contributions.find(
        (item) => item.measureId === c.measure_id,
      );
      if (!contribution) throw new Error("UNVERIFIED_EFFECT");
      const computation =
        contribution.kind === "measure"
          ? `${formatExact(contribution.full)} × ${formatExact(contribution.factor)} = ${contribution.delta > 0 ? "+" : ""}${formatExact(contribution.delta)} п.`
          : `${signed(contribution.delta)} п. (${contribution.kind === "event" ? "допущение команды" : "фиксированная синергия"})`;
      return {
        label: `${scope} · ${district.name} · ${metric.name} · ${contribution.measureId}`,
        value: computation,
        evidenceId: e.id,
        resultId: result.id,
      };
    }
    const change = e.value - e.initial;
    return {
      label: `${scope} · ${district.name} · ${metric.name}`,
      value: `${format(e.initial)} → ${format(e.value)} (${signed(change)} п.)`,
      evidenceId: e.id,
      resultId: result.id,
    };
  });
  const summary =
    parsed.intent === "outside_model"
      ? "Для такого вывода в учебной модели недостаточно данных. Можно проверить выбранные меры, показатели, ограничения и учебную зиму."
      : parsed.intent === "rules"
        ? "Ниже — правила, полученные из инструмента модели."
        : parsed.intent === "explain"
          ? "Показанные изменения подтверждены журналом расчёта. Нажмите на факт, чтобы увидеть исходное значение и каждый применённый эффект."
          : `Официальный расчёт${ctx.winter ? " и отдельный учебный эксперимент" : ""} выполнен инструментами. Ниже — проверенные результаты выбранного плана.`;
  const narrative = parsed.response?.paragraphs.map((paragraph) => {
    const plain = paragraph.replace(/\{fact:\d+\}/g, "");
    // Numeric literals must be inserted from a verified claim, never model prose.
    if (/[\p{N}%=<>]/u.test(plain) || /(?:^|[^\p{L}])(?:ноль|нул[ьяюе]|один|одна|одно|дв[ае]|три|четыре|пять|шесть|семь|восемь|девять|десять|сорок|сто|процентов)(?:$|[^\p{L}])/iu.test(plain))
      throw new Error("UNVERIFIED_NARRATIVE_NUMBER");
    return paragraph.replace(/\{fact:(\d+)\}/g, (_, index: string) => {
      const fact = facts[Number(index)];
      if (!fact) throw new Error("UNKNOWN_NARRATIVE_FACT");
      return `${fact.label}: ${fact.value}`;
    });
  });
  const fullReport = parsed.response ? parsed.response.kind === "audit" : true;
  // Presentation only: numbers come from completed engine results, never model prose.
  const official = [...ctx.results.values()].find((r) => r.kind === "official");
  const primary = facts.find((f) => f.evidenceId) ?? facts[0];
  const shown = primary?.resultId
    ? ctx.results.get(primary.resultId)
    : undefined;
  const numerical = parsed.intent === "audit" || parsed.intent === "explain";
  const risks: Fact[] = [];
  if (numerical && shown) {
    risks.push({
      label:
        shown.kind === "experimental"
          ? "В учебном эксперименте"
          : "В расчёте по заданию",
      value: `Значений ниже порога: ${shown.criticalPairs.length}. Минимум по районам: ${format(shown.minimum)}.`,
      resultId: shown.id,
    });
    for (const c of parsed.claims) {
      const e = c.evidence_id ? ctx.evidence.get(c.evidence_id) : undefined;
      if (
        e &&
        e.value < e.initial &&
        !risks.some((f) => f.evidenceId === e.id)
      ) {
        const fact = facts.find((f) => f.evidenceId === e.id);
        if (fact)
          risks.push({
            label: `${model.districts.find((d) => d.id === e.districtId)!.name} · ${model.metrics.find((m) => m.id === e.metricId)!.name}`,
            value: `Снижение: ${format(e.initial)} → ${format(e.value)}.`,
            evidenceId: e.id,
            resultId: c.result_id!,
          });
      }
      if (risks.length >= 3) break;
    }
  }
  return {
    summary: narrative?.[0] ?? summary,
    ...(narrative ? { narrative, responseKind: parsed.response!.kind } : {}),
    facts,
    details: {
      ...(fullReport && numerical && official && ctx.executed.has("evaluate_scenario")
        ? {
            budget: {
              label: "Стоимость и бюджет",
              value: `${format(official.cost)} из ${format(official.cost + official.remaining)} ед. Остаток: ${format(official.remaining)} ед. Ограничения плана соблюдены.`,
              resultId: official.id,
            },
          }
        : {}),
      risks: fullReport ? risks : [],
      nextChecks: parsed.response ? [] : numerical
        ? [
            ...(facts.some((f) => f.evidenceId)
              ? ["Сверьте слагаемые выбранного показателя в расчёте."]
              : ["Уточните интересующий район и показатель."]),
            ctx.winter
              ? "Сопоставьте результат по заданию с учебной зимой."
              : "Проверьте план в доступном учебном зимнем эксперименте.",
            shown?.criticalPairs.length
              ? "Проверьте показатели ниже порога и разберите их вычисления."
              : "Проверьте другие показатели районов перед изменением плана.",
          ]
        : [
            "Уточните вопрос в пределах учебных данных.",
            "Выберите район с данными и попросите проверить его показатель.",
          ],
    },
    limitations: parsed.response ? [] : [
      "Синтетическая учебная модель: результат не является рекомендацией реальной городской политики.",
      ...(ctx.winter
        ? [
            "Зимние коэффициенты заданы командой. Эксперимент не заменяет официальный результат и не доказывает безопасность.",
          ]
        : []),
    ],
  };
}
