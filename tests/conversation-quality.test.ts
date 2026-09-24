import { describe, it, expect } from "vitest";
import { model } from "../src/lib/model/engine";
import { createContext, executeTool } from "../src/lib/ai/tools";
import { verifyAnswer } from "../src/lib/ai/explanation";
const ctx = createContext(model.source_example.decisions, true);
const decisions = model.source_example.decisions.map(d => ({...d, district_id: d.district_id ?? null}));
executeTool("evaluate_scenario", {decisions}, ctx);
executeTool("run_stress_test", {decisions, event_id:"winter_demo"}, ctx);
const result = [...ctx.results.values()].find(r=>r.kind === "official")!;
executeTool("get_evidence", {result_id:result.id, district_id:"nura", metric_id:"T2"}, ctx);
const claims = [{kind:"indicator", result_id:result.id, evidence_id:`${result.id}:nura:T2`, measure_id:null,field:null,rule_id:null}];
describe("question-specific verified explanations",()=>{
 it.each(["indicator","district","comparison","cause","map","risks","next_checks"])("keeps %s focused without budget or generic advice",kind=>{
  const answer=verifyAnswer({intent:"explain",claims,response:{kind,paragraphs:["Доступность транспорта: {fact:0}. Выбранные меры не изменили этот показатель."]}},ctx);
  expect(answer.narrative?.[0]).toContain("40,00 → 40,00");
  expect(answer.details?.budget).toBeUndefined();
  expect(answer.details?.nextChecks).toEqual([]);
  expect(answer.limitations).toEqual([]);
 });
 it("keeps budget for a full audit",()=>{
  expect(verifyAnswer({intent:"audit",claims,response:{kind:"audit",paragraphs:["Результат проверки: {fact:0}."]}},ctx).details?.budget).toBeDefined();
 });
 it.each(["Значение равно 999.","Значение равно сорок.","Результат {fact:8}."])("rejects fabricated values or references: %s",text=>{
  expect(()=>verifyAnswer({intent:"explain",claims,response:{kind:"indicator",paragraphs:[text]}},ctx)).toThrow();
 });
});
