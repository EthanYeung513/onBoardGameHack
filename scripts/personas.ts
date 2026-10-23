// Usage: npm run personas -- [--per 5] [--out eval/personas/answers.json]
// Writes synthetic hire answers: every free-text card × every persona × --per answers (12 × 5 × 5 = 300 by default).
// With MUBIT_API_KEY set the answers come from the `persona` task through Mubit; otherwise from templates.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { acmePay } from "../content/acme-pay/world";
import type { PersonaAnswer } from "../src/data/bulk";
import { generatePersonaAnswers, PERSONAS, type Persona } from "../src/data/personas";
import { chunkMarkdown } from "../src/lib/chunk";
import { getLlm } from "../src/llm";
import { defaultModel } from "../src/llm/env";

const { values } = parseArgs({
  options: {
    per: { type: "string", default: "5" },
    out: { type: "string", default: path.join("eval", "personas", "answers.json") },
  },
});
const per = Number(values.per);
const llm = getLlm();
const contentDir = path.join(process.cwd(), "content", "acme-pay");

const jobs: { card: string; persona: Persona; scenario: string; policy: string; expertAnswer: string; redFlags: string[] }[] = [];
for (const pack of acmePay.packs) {
  for (const card of pack.cards.filter((c) => c.type === "free_text")) {
    const doc = pack.docs.find((d) => d.slug === card.source.doc)!;
    const policy = chunkMarkdown(readFileSync(path.join(contentDir, doc.file), "utf8")).find((c) => c.heading === card.source.heading)?.text ?? "";
    for (const persona of Object.keys(PERSONAS) as Persona[]) {
      jobs.push({ card: card.prompt.slice(0, 60), persona, scenario: card.prompt, policy, expertAnswer: card.expertAnswer ?? "", redFlags: card.rubric?.redFlags ?? [] });
    }
  }
}

const out: PersonaAnswer[] = [];
let done = 0;
for (const job of jobs) {
  const answers = await generatePersonaAnswers(llm, defaultModel(), { ...job, count: per });
  out.push(...answers.map((answer) => ({ card: job.card, persona: job.persona, answer })));
  process.stdout.write(`\r${++done}/${jobs.length} card × persona batches`);
}
mkdirSync(path.dirname(values.out!), { recursive: true });
writeFileSync(values.out!, JSON.stringify(out, null, 2) + "\n");
console.log(`\nWrote ${out.length} answers (${llm.mode}) to ${values.out}`);
process.exit(0);
