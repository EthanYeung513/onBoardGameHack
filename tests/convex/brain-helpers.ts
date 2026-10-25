import { convexTest } from "convex-test";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import { chunkText, contentHash } from "@/worker/chunk";
import { createEmbedder } from "@/worker/providers/embed";
import type { Llm } from "@/worker/providers/llm";
import type { StageContext, StageDefinition, WorkerConvex } from "@/worker/types";

// Runs the real worker stages against convex-test: the worker's Convex client is the test backend.

export const secret = "test-secret";
const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);

export type T = ReturnType<typeof convexTest>;

export async function brainSetup(threshold = 0.9) {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await mgr.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  await t.run((ctx) => ctx.db.patch(spaceId, { autoApproveThreshold: threshold }));
  type Call = (fn: unknown, args: unknown) => Promise<unknown>;
  const loose = t as unknown as { query: Call; mutation: Call; action: Call };
  const convex: WorkerConvex = {
    query: (fn, args) => loose.query(fn, { ...args, secret }) as never,
    mutation: (fn, args) => loose.mutation(fn, { ...args, secret }) as never,
    action: (fn, args) => loose.action(fn, { ...args, secret }) as never,
  };
  return { t, mgr, userId, spaceId, convex };
}

/** Ingest one document the way every source does (versioned item + embedded chunks). */
export async function ingest(t: T, convex: WorkerConvex, spaceId: Id<"spaces">, doc: { externalId: string; text: string; connectorId?: Id<"connectors">; kind?: Doc<"source_items">["kind"] }) {
  const embed = createEmbedder();
  const res = await convex.mutation(api.ingest.upsertItem, {
    spaceId,
    connectorId: doc.connectorId,
    kind: doc.kind ?? "doc",
    externalId: doc.externalId,
    title: doc.externalId,
    contentHash: contentHash(doc.text),
  });
  const chunks = chunkText(doc.text);
  const vectors = await embed.embed(chunks.map((c) => c.text));
  if (res.status !== "unchanged") {
    await convex.mutation(api.ingest.addChunks, { sourceItemId: res.sourceItemId, version: res.version, chunks: chunks.map((c, i) => ({ ...c, embedding: vectors[i] })) });
  }
  return res;
}

export async function runStage(
  def: StageDefinition,
  opts: { t: T; convex: WorkerConvex; spaceId: Id<"spaces">; llm: Llm; cursor?: Record<string, unknown>; remaining?: () => number },
) {
  const space = (await opts.t.run((ctx) => ctx.db.get(opts.spaceId)))!;
  const t0 = Date.now();
  const events: string[] = [];
  const ctx: StageContext = {
    job: { cursor: opts.cursor ?? {} } as Doc<"jobs">,
    space,
    scan: null,
    connector: null,
    convex: opts.convex,
    llm: opts.llm,
    embed: createEmbedder(),
    remainingMs: opts.remaining ?? (() => 600_000 - (Date.now() - t0)),
    lost: () => false,
    event: async (_l, m) => void events.push(m),
    progress: async () => undefined,
  };
  return { result: await def.run(ctx), events };
}

/**
 * Scripted "live" extractor: every `- line {0.95}` in the chunk becomes a fact about the chunk's
 * heading (a term entity); `owner: Name <email>` lines become people. Records each user message.
 */
function scriptExtract(text: string) {
  const heading = text.match(/^#+\s+(.+)$/m)?.[1] ?? "General";
  const entities: unknown[] = [{ type: "term", name: heading, aliases: [], keys: {} }];
  const facts: unknown[] = [];
  for (const m of text.matchAll(/^- (.+?)(?: \{([\d.]+)\})?$/gm)) {
    const start = m.index ?? 0;
    facts.push({ category: "Rituals", text: m[1], entity_names: [heading], confidence: m[2] ? Number(m[2]) : 0.95, span: { start, end: start + m[0].length } });
  }
  for (const m of text.matchAll(/^owner: (.+?) <(.+?)>$/gm)) entities.push({ type: "person", name: m[1], aliases: [], keys: { email: m[2] } });
  return { facts, entities, edges: [] };
}

export function scriptedLlm() {
  const users: string[] = [];
  const llm: Llm = {
    live: true,
    async json(req) {
      users.push(req.user);
      if (req.task === "brain_extract_batch") {
        // Batched calls: one result per "### Passage id: pN … <<< … >>>" block.
        const results = [...req.user.matchAll(/### Passage id: (p\d+)[\s\S]*?<<<\n([\s\S]*?)\n>>>/g)].map((m) => ({ id: m[1], ...scriptExtract(m[2]) }));
        return { value: req.schema.parse({ results }), mode: "live", model: "scripted", requestId: null };
      }
      const text = req.user.split("<<<\n")[1]?.split("\n>>>")[0] ?? "";
      return { value: req.schema.parse(scriptExtract(text)), mode: "live", model: "scripted", requestId: null };
    },
  };
  return { llm, users };
}
