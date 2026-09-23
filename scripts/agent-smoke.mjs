import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const url = process.env.CITYPROOF_TEST_URL || "http://127.0.0.1:3000";
const status = await fetch(`${url}/api/analyze`);
const cookie = status.headers.get("set-cookie")?.split(";")[0];
const config = await status.json();
if (!config.configured) {
  console.error(
    "BLOCKED: server requires local OPENAI_API_KEY and OPENAI_MODEL. No model call was made.",
  );
  process.exit(2);
}
const source = JSON.parse(
  await readFile(new URL("../hackalem_model.json", import.meta.url), "utf8"),
);
const request = {
  decisions: source.source_example.decisions,
  winter: true,
  question:
    "Проверь план по заданию и при учебной зиме. Покажи оба Score и объясни изменение C1 в Сарыарке с evidence.",
};
async function audit(body) {
  const response = await fetch(`${url}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, `API returned ${response.status}`);
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert(
    !events.some((e) => e.type === "error"),
    "Agent reported an incomplete audit",
  );
  assert(
    events.some((e) => e.type === "answer"),
    "No verified answer",
  );
  return events;
}
const events = await audit(request);
const calls = events
  .filter((e) => e.type === "tool" && e.status === "completed")
  .map((e) => e.name);
for (const name of ["evaluate_scenario", "run_stress_test", "get_evidence"])
  assert(calls.includes(name), `Missing real tool call: ${name}`);
assert(events.some((e) => e.type === "result" && e.result.kind === "official"));
assert(
  events.some((e) => e.type === "result" && e.result.kind === "experimental"),
);
const runId = events.find((e) => e.type === "run").runId;
await audit({
  ...request,
  runId,
  question:
    "Почему изменился B1 в Нуре? Раскрой действие меры и синергии инструментом evidence.",
});
console.log(
  JSON.stringify(
    {
      status: "passed",
      provider: "live API",
      completedTools: calls,
      followup: "verified",
      note: "No secret values or authorization headers printed.",
    },
    null,
    2,
  ),
);
