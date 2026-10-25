import { getFunctionName } from "convex/server";
import type { StageContext } from "../types";

// Opt-in profiler for the brain stages (`BRAIN_PROFILE=1` on the worker): wraps the stage context
// so every Convex call, embedding call and model call is timed, and prints one JSON line per call
// to the worker log. Off by default; it never changes behaviour.

export const profiling = () => process.env.BRAIN_PROFILE === "1";

export function profiled(ctx: StageContext, label: string): StageContext {
  if (!profiling()) return ctx;
  const t0 = Date.now();
  const log = (kind: string, name: string, ms: number, extra: Record<string, unknown> = {}) =>
    console.log(`[brain-profile] ${JSON.stringify({ stage: label, job: ctx.job._id, ts: Date.now(), at: Date.now() - t0, kind, name, ms, ...extra })}`);
  const time = async <R>(kind: string, name: string, run: () => Promise<R>, extra?: (r: R) => Record<string, unknown>) => {
    const s = Date.now();
    const r = await run();
    log(kind, name, Date.now() - s, extra?.(r));
    return r;
  };
  const fname = (fn: unknown) => getFunctionName(fn as never);
  const size = (r: unknown) => (Array.isArray(r) ? { n: r.length } : {});
  return {
    ...ctx,
    convex: {
      query: (fn, args) => time("query", fname(fn), () => ctx.convex.query(fn, args), size),
      mutation: (fn, args) => time("mutation", fname(fn), () => ctx.convex.mutation(fn, args), size),
      ...(ctx.convex.action ? { action: (fn, args) => time("action", fname(fn), () => ctx.convex.action!(fn, args), size) } : {}),
    },
    embed: { mode: ctx.embed.mode, embed: (texts) => time("embed", "embed", () => ctx.embed.embed(texts), () => ({ n: texts.length })) },
    llm: {
      live: ctx.llm.live,
      json: (req) =>
        time("llm", req.task, () => ctx.llm.json(req), (r) => ({ chars: req.user.length, ...(r.usage ? { input: r.usage.input, output: r.usage.output, attempts: r.usage.attempts, errors: r.usage.retryErrors } : {}) })),
    },
  };
}
