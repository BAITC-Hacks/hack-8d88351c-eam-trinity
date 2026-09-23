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
    "Покажи изменения ЖКХ в Сарыарке после зимнего события и объясни причину.",
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
for (const name of [
  "evaluate_scenario",
  "run_stress_test",
  "get_evidence",
  "show_evidence_on_map",
])
  assert(calls.includes(name), `Missing real tool call: ${name}`);
assert(events.some((e) => e.type === "result" && e.result.kind === "official"));
assert(
  events.some((e) => e.type === "result" && e.result.kind === "experimental"),
);
const commands = events.filter((e) => e.type === "map_command");
assert.equal(commands.length, 1, "Expected one map command");
assert.equal(commands[0].command.districtId, "saryarka");
assert.equal(commands[0].command.metricId, "C1");
assert.equal(commands[0].command.mode, "experimental");
const result = events.find(
  (e) => e.type === "result" && e.result.id === commands[0].command.resultId,
)?.result;
assert.equal(result?.evidence[commands[0].command.evidenceId]?.value, 39.5);
const runId = events.find((e) => e.type === "run").runId;
const followup = await audit({
  ...request,
  runId,
  question:
    "Почему изменился B1 в Нуре? Раскрой действие меры и синергии инструментом evidence.",
});
assert(
  !followup.some((e) => e.type === "map_command"),
  "Explanation alone must not move map",
);
console.log(
  JSON.stringify(
    {
      status: "passed",
      provider: "live API",
      completedTools: calls,
      followup: "verified",
      note: "Server stream verified; actual browser application is checked separately. No secrets printed.",
    },
    null,
    2,
  ),
);
