import { randomUUID } from "node:crypto";
import { createContext, type ToolContext } from "./tools";
import type { Answer } from "./explanation";
import { snapshotKey, type Decision } from "../model/engine";
type Run = {
  owner: string;
  key: string;
  expires: number;
  ctx: ToolContext;
  history: { question: string; answer: Answer }[];
  busy: boolean;
};
const state: {
  runs: Map<string, Run>;
  requests: Map<string, number[]>;
  active: number;
  globalRequests: number[];
} = { runs: new Map(), requests: new Map(), active: 0, globalRequests: [] };
const TTL = 20 * 60_000;
export function acquireRun(
  owner: string,
  decisions: Decision[],
  winter: boolean,
  runId?: string,
) {
  const now = Date.now();
  for (const [id, run] of state.runs)
    if (run.expires < now && !run.busy) state.runs.delete(id);
  for (const [id, times] of state.requests)
    if (times.every((t) => t < now - 60_000)) state.requests.delete(id);
  state.globalRequests = state.globalRequests.filter((t) => t > now - 60_000);
  const requests = (state.requests.get(owner) ?? []).filter(
    (t) => t > now - 60_000,
  );
  if (
    requests.length >= 6 ||
    state.globalRequests.length >= 20 ||
    state.active >= 2
  )
    throw new Error("RATE_LIMIT");
  const key = snapshotKey(decisions, winter);
  let run: Run | undefined;
  if (runId) {
    run = state.runs.get(runId);
    if (!run || run.owner !== owner || run.key !== key || run.expires < now)
      throw new Error("STALE_RUN");
    if (run.busy) throw new Error("RUN_BUSY");
  } else {
    if (state.runs.size >= 50) throw new Error("CAPACITY");
    runId = randomUUID();
    run = {
      owner,
      key,
      expires: now + TTL,
      ctx: createContext(decisions, winter),
      history: [],
      busy: false,
    };
    state.runs.set(runId, run);
  }
  requests.push(now);
  state.requests.set(owner, requests);
  state.globalRequests.push(now);
  state.active++;
  run!.busy = true;
  run!.expires = now + TTL;
  const activeRun = run!;
  let released = false;
  return {
    id: runId!,
    run: activeRun,
    release: () => {
      if (released) return;
      released = true;
      activeRun.busy = false;
      state.active--;
    },
  };
}
