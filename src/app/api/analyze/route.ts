import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import {
  scenarioSchema,
  validate,
  districtIds,
  metricIds,
} from "@/lib/model/engine";
import { acquireRun } from "@/lib/ai/sessions";
import { createTransport, runAgent, type AgentEvent } from "@/lib/ai/runner";
export const runtime = "nodejs";
export const maxDuration = 60;
const requestSchema = scenarioSchema
  .extend({
    question: z.string().trim().min(1).max(1200),
    winter: z.boolean(),
    runId: z.string().uuid().optional(),
    focus: z
      .object({
        district_id: z.enum(districtIds),
        metric_id: z.enum(metricIds),
      })
      .strict()
      .optional(),
  })
  .strict();
const configured = () =>
  Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
async function owner() {
  const jar = await cookies();
  let id = jar.get("cityproof-session")?.value;
  if (!id || !z.string().uuid().safeParse(id).success) {
    id = randomUUID();
    jar.set("cityproof-session", id, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 1200,
    });
  }
  return id;
}
export async function GET() {
  await owner();
  return Response.json(
    { configured: configured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // Next may normalize request.url to localhost while the real incoming Host is 127.0.0.1.
  const host = request.headers.get("host") ?? new URL(request.url).host;
  let sameOrigin = true;
  if (origin) {
    try {
      const parsed = new URL(origin);
      sameOrigin =
        parsed.host === host &&
        parsed.protocol === new URL(request.url).protocol;
    } catch {
      sameOrigin = false;
    }
  }
  if (!sameOrigin || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json(
      { error: "Недопустимый источник запроса." },
      { status: 403 },
    );
  if (!configured())
    return Response.json(
      {
        error:
          "AI-анализ недоступен: настройте OPENAI_API_KEY и OPENAI_MODEL в .env.local на сервере.",
      },
      { status: 503 },
    );
  let data: z.infer<typeof requestSchema>;
  try {
    if (Number(request.headers.get("content-length")) > 16000)
      throw new Error("large");
    const text = await request.text();
    if (text.length > 16000) throw new Error("large");
    data = requestSchema.parse(JSON.parse(text));
  } catch {
    return Response.json(
      {
        error:
          "Некорректный запрос: проверьте решения и длину вопроса (до 1200 символов).",
      },
      { status: 400 },
    );
  }
  const issues = validate({ decisions: data.decisions });
  if (issues.length)
    return Response.json(
      { error: issues.map((e) => e.message).join(" "), issues },
      { status: 422 },
    );
  let lease: ReturnType<typeof acquireRun>;
  try {
    lease = acquireRun(await owner(), data.decisions, data.winter, data.runId);
  } catch (error) {
    const stale = error instanceof Error && error.message === "STALE_RUN";
    return Response.json(
      {
        error: stale
          ? "Запуск устарел или сервер перезапущен. Измените план или сбросьте анализ и запустите новую проверку."
          : "Достигнут лимит анализов. Завершите текущую проверку и повторите позже.",
      },
      { status: stale ? 409 : 429 },
    );
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    controller.signal,
    AbortSignal.timeout(45_000),
  ]);
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      let closed = false;
      const encoder = new TextEncoder();
      const emit = (event: AgentEvent) => {
        if (closed) return;
        try {
          output.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
          controller.abort();
        }
      };
      emit({ type: "run", runId: lease.id });
      try {
        const answer = await runAgent({
          ctx: lease.run.ctx,
          question: data.question,
          focus: data.focus,
          model: process.env.OPENAI_MODEL!,
          signal,
          emit,
          transport: createTransport(),
          history: lease.run.history,
        });
        lease.run.history.push({ question: data.question, answer });
        lease.run.history = lease.run.history.slice(-2);
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? error.status
            : null;
        const text = signal.aborted
          ? "Анализ остановлен или превышено время ожидания. Подтверждённого полного ответа нет."
          : status === 401
            ? "Провайдер отклонил серверный API-доступ. Проверьте локальные настройки."
            : status === 429
              ? "Провайдер сообщил об ограничении квоты или частоты запросов."
              : status === 404
                ? "Указанная модель или API endpoint недоступны."
                : "Агент не смог завершить подтверждённый ответ. Повторите запрос; проверьте поддержку Responses API и инструментов выбранной моделью.";
        emit({ type: "error", text });
      } finally {
        lease.release();
        if (!closed) {
          closed = true;
          try {
            output.close();
          } catch {
            /* The browser already cancelled the stream. */
          }
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
