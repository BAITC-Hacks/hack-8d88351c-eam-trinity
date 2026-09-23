import { test, expect } from "@playwright/test";
import source from "../../hackalem_model.json" with { type: "json" };
const decisions = source.source_example.decisions;
test("a same-origin browser request passes origin validation", async ({
  request,
  baseURL,
}) => {
  const response = await request.post("/api/analyze", {
    data: {},
    headers: { Origin: baseURL! },
  });
  expect([400, 503]).toContain(response.status());
});
test("server calculates the source example and its evidence", async ({
  request,
}) => {
  const response = await request.post("/api/simulate", { data: { decisions } });
  expect(response.status()).toBe(200);
  const { result } = await response.json();
  expect(result.score).toBeCloseTo(source.verification.source_example.score, 8);
  expect(result.cost).toBe(95);
  expect(result.evidence[`${result.id}:nura:B1`].value).toBe(67.5);
});
test("server rejects invalid plans and forged coefficients", async ({
  request,
}) => {
  for (const data of [
    { decisions: [] },
    { decisions, cost: 0 },
    { decisions: decisions.map((d) => ({ ...d, effects: { C1: 999 } })) },
  ]) {
    const response = await request.post("/api/simulate", { data });
    expect(response.status()).toBe(422);
    expect(await response.json()).toMatchObject({ valid: false, score: null });
  }
});
test("winter is separate, deterministic and does not change official data", async ({
  request,
}) => {
  const official = await (
    await request.post("/api/simulate", { data: { decisions } })
  ).json();
  const first = await (
    await request.post("/api/stress", {
      data: { decisions, event_id: "winter_demo" },
    })
  ).json();
  const repeat = await (
    await request.post("/api/stress", {
      data: { decisions, event_id: "winter_demo" },
    })
  ).json();
  expect(first).toEqual(repeat);
  expect(first.result.kind).toBe("experimental");
  expect(first.result.indicators.saryarka.C1).toBe(39.5);
  expect(first.result.score).toBeCloseTo(53.34307, 8);
  const after = await (
    await request.post("/api/simulate", { data: { decisions } })
  ).json();
  expect(after).toEqual(official);
});
test("unknown event and malformed JSON are rejected", async ({ request }) => {
  expect(
    (
      await request.post("/api/stress", {
        data: { decisions, event_id: "unknown" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/simulate", {
        data: Buffer.from("{"),
        headers: { "Content-Type": "application/json" },
      })
    ).status(),
  ).toBe(400);
});
test("status discloses only availability, missing API fails honestly", async ({
  request,
}) => {
  const status = await request.get("/api/analyze");
  const body = await status.json();
  expect(Object.keys(body)).toEqual(["configured"]);
  expect(typeof body.configured).toBe("boolean");
  expect(status.headers()["set-cookie"]).toContain("HttpOnly");
  if (!body.configured) {
    const response = await request.post("/api/analyze", {
      data: { decisions, winter: true, question: "Проверь план" },
    });
    expect(response.status()).toBe(503);
    expect((await response.json()).error).toContain("OPENAI_API_KEY");
  }
});
test("cross-origin analysis requests are denied before contacting a model", async ({
  request,
}) => {
  const response = await request.post("/api/analyze", {
    data: { decisions, winter: true, question: "Проверь" },
    headers: { Origin: "https://foreign.example" },
  });
  expect(response.status()).toBe(403);
});
