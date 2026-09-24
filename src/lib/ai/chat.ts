import { z } from "zod";
import type { Answer } from "./explanation";

// UI transcript only; no tool arguments, credentials or full result matrices.
export type TraceEvent = {
  type: string;
  name?: string;
  status?: string;
  text?: string;
  commandId?: string;
  resultKind?: string;
};
export type ChatTurn = {
  id: string;
  key: string;
  question: string;
  events: TraceEvent[];
  status: "running" | "complete" | "cancelled" | "error";
  answer?: Answer;
  error?: string;
  restored?: boolean;
};
const fact = z.object({
  label: z.string(),
  value: z.string(),
  evidenceId: z.string().optional(),
  resultId: z.string().optional(),
});
const storedTurns = z.array(
  z.object({
    id: z.string(),
    key: z.string(),
    question: z.string(),
    status: z.enum(["running", "complete", "cancelled", "error"]),
    events: z.array(
      z.object({
        type: z.string(),
        name: z.string().optional(),
        status: z.string().optional(),
        text: z.string().optional(),
        commandId: z.string().optional(),
        resultKind: z.string().optional(),
      }),
    ),
    answer: z
      .object({
        summary: z.string(),
        narrative: z.array(z.string()).optional(),
        responseKind: z.string().optional(),
        facts: z.array(fact),
        limitations: z.array(z.string()),
        details: z
          .object({
            budget: fact.optional(),
            risks: z.array(fact),
            nextChecks: z.array(z.string()),
          })
          .optional(),
      })
      .optional(),
    error: z.string().optional(),
    restored: z.boolean().optional(),
  }),
);
export function restoreTranscript(raw: string | null): ChatTurn[] {
  try {
    const parsed = storedTurns.safeParse(JSON.parse(raw ?? "[]"));
    return parsed.success
      ? parsed.data.map((turn) => ({
          ...turn,
          restored: true,
          events:
            turn.events.findLast((e) => e.type === "map_status")?.status ===
            "requested"
              ? [
                  ...turn.events,
                  {
                    type: "map_status",
                    status: "cancelled",
                    text: "Незавершённый переход отменён при обновлении страницы.",
                  },
                ]
              : turn.events,
          status: turn.status === "running" ? "cancelled" : turn.status,
          ...(turn.status === "running"
            ? {
                error:
                  "Страница была обновлена. Незавершённый ответ не подтверждён.",
              }
            : {}),
        }))
      : [];
  } catch {
    return [];
  }
}
export function executionSteps(events: TraceEvent[]) {
  const completed = (name: string) =>
    events.some(
      (e) => e.type === "tool" && e.name === name && e.status === "completed",
    );
  const steps: { label: string; state: "done" | "moving" | "notice" }[] = [];
  if (events.some((e) => e.type === "result" && e.resultKind === "official")) {
    steps.push(
      { label: "Проверен план", state: "done" },
      { label: "Рассчитаны последствия", state: "done" },
    );
  }
  if (
    events.some((e) => e.type === "result" && e.resultKind === "experimental")
  )
    steps.push({ label: "Выполнен учебный стресс-тест", state: "done" });
  if (completed("get_model_rules"))
    steps.push({ label: "Получены правила модели", state: "done" });
  if (completed("get_evidence"))
    steps.push({ label: "Подтверждены вычисления", state: "done" });
  const map = events.findLast((e) => e.type === "map_status");
  if (map)
    steps.push(
      map.status === "applied"
        ? { label: "Результат показан на карте", state: "done" }
        : map.status === "requested"
          ? { label: "Показываю результат на карте", state: "moving" }
          : { label: map.text ?? "Переход не выполнен", state: "notice" },
    );
  if (events.some((e) => e.type === "tool" && e.status === "failed"))
    steps.push({
      label:
        "Инструмент вернул ошибку; учтены только подтверждённые результаты",
      state: "notice",
    });
  return steps;
}
