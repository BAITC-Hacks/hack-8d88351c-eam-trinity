import { z } from "zod";
import {
  districtIds,
  model,
  metricIds,
  snapshotKey,
  type Evidence,
  type Result,
} from "../model/engine";
import { featureForDistrict, districts } from "./geography";

export const mapCommandSchema = z
  .object({
    id: z.string().uuid(),
    snapshotKey: z.string(),
    evidenceId: z.string(),
    resultId: z.string(),
    districtId: z.enum(districtIds),
    metricId: z.enum(metricIds),
    mode: z.enum(["official", "experimental"]),
    featureId: z.string(),
  })
  .strict();
export type MapCommand = z.infer<typeof mapCommandSchema>;

export function requestedMapTarget(question: string) {
  const normalize = (s: string) =>
    s.toLowerCase().replaceAll("ё", "е").replaceAll("қ", "к");
  const text = normalize(question);
  const metrics = model.metrics.filter((m) => {
    const code = new RegExp(
      `(?:^|[^a-z0-9])${m.id.toLowerCase()}(?:$|[^a-z0-9])`,
    );
    return (
      code.test(text) ||
      text.includes(normalize(m.name)) ||
      (m.id === "C1" && /жкх|коммунальн/u.test(text))
    );
  });
  const matches = districts.filter((d) => {
    const names = [
      d.name,
      model.districts.find((m) => m.id === d.modelDistrictId)?.name,
    ].filter((n): n is string => !!n);
    return names.some((name) => {
      const stem = normalize(name).replace(/[аь]$/u, "");
      return new RegExp(
        `(?:^|[^\\p{L}])${stem}(?:а|е|и|у|ы|ой|ом|ь|ю)?(?:$|[^\\p{L}])`,
        "u",
      ).test(text);
    });
  });
  return {
    metric: metrics.length === 1 ? metrics[0].id : undefined,
    district: matches.length === 1 ? matches[0].modelDistrictId : undefined,
  };
}

export function requestedMapMode(
  question: string,
): "official" | "experimental" | undefined {
  const text = question.toLowerCase().replaceAll("ё", "е");
  if (
    /без\s+(?:учебной\s+)?зим|обычн.{0,15}услови|по заданию|после\s+(?:решени|мероприяти|мер(?:\s|$))/u.test(
      text,
    ) &&
    !/после\s+(?:учебн.{0,4}\s+)?зим|при\s+(?:учебн.{0,4}\s+)?зим/u.test(text)
  )
    return "official";
  if (/зим|стресс|эксперимент|winter/u.test(text)) return "experimental";
  if (/официальн|after (?:decisions|measures)|official/u.test(text))
    return "official";
}

// Browser resolves the payload against its current engine results as a second
// boundary. Commands never carry coordinates, executable code or model values.
export function resolveMapCommand(
  value: unknown,
  key: string,
  results: Result[],
) {
  const parsed = mapCommandSchema.safeParse(value);
  if (!parsed.success || parsed.data.snapshotKey !== key) return null;
  const c = parsed.data,
    result = results.find((r) => r.id === c.resultId);
  const evidence = result?.evidence[c.evidenceId];
  if (
    !result ||
    !evidence ||
    result.kind !== c.mode ||
    evidence.districtId !== c.districtId ||
    evidence.metricId !== c.metricId ||
    featureForDistrict(c.districtId).mapFeatureId !== c.featureId
  )
    return null;
  return { command: c, evidence };
}
export function commandForEvidence(
  id: string,
  result: Result,
  evidence: Evidence,
  winter: boolean,
): MapCommand {
  if (result.kind === "baseline" || result.evidence[evidence.id] !== evidence)
    throw new Error("UNVERIFIED_EVIDENCE");
  return {
    id,
    snapshotKey: snapshotKey(result.decisions, winter),
    evidenceId: evidence.id,
    resultId: result.id,
    districtId: evidence.districtId,
    metricId: evidence.metricId,
    mode: result.kind,
    featureId: featureForDistrict(evidence.districtId).mapFeatureId,
  };
}

// Conservative current-question gate. The model still chooses the district,
// indicator and result by retrieving evidence; a prior request grants no power.
export function requestsMapDisplay(question: string) {
  const text = question
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[«“"].*?[»”"]/gu, "");
  if (
    /(?:что (?:значит|означает)|как работает).{0,50}(?:кнопк|команд|инструмент)|(?:как|зачем|почему)\s+(?:мне\s+)?(?:показать|открыть|выделить)/u.test(
      text,
    )
  )
    return false;
  if (
    /(?:не|не надо|не нужно|не стоит)\s+(?:показыв|покаж|откры|откро|выдел|перемещ|перевод|переход|приближай|приблизь|наводи|наведи)|\b(?:don't|do not|without)\b.{0,25}\b(?:show|open|move|focus)/u.test(
      text,
    )
  )
    return false;
  return /(?:^|[^\p{L}])(?:покаж(?:и|ите)?|показать|откро(?:й|йте)|открыть|выдел(?:и|ите)|выделить|перейди|перейдите|приблизь|приблизить|наведи|навести)(?:$|[^\p{L}])|\b(?:show|open|zoom|focus|display)\b/iu.test(
    text,
  );
}
