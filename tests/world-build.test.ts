import { describe, expect, it } from "vitest";
import { findGame } from "@/games/core/instantiate";
import { buildWorld, fit, type WorldInput } from "@/lib/world/build";

const quiz = (id: string, title: string, right: string, wrong: string[], why = "Because that is how it works here.") => ({
  id, kind: "quiz", title, options: [{ label: right, correct: true, why }, ...wrong.map((label) => ({ label }))], teaches_fact_ids: ["f1"],
});
const scenario = (id: string, title: string, body: string) => ({
  id, kind: "scenario", title, body, options: [{ label: "Report it in #security", correct: true, why: "Security wants every report." }, { label: "Ignore it" }], teaches_fact_ids: ["f1"],
});
const course = (packType: string, title: string, stepList: unknown[]) => ({ packType, title, building: "Town Hall", spec: { title, steps: [{ id: "w", kind: "welcome", title: "Hi" }, ...stepList, { id: "d", kind: "done", title: "Done" }] } });
const people = ["Priya Shah", "Sam Lee", "Aisha Khan", "Tom Ford", "Lena Park"];
const facts = [
  ...people.map((n, i) => ({ text: `${n} leads team ${i + 1} and reviews its launches.`, category: "People", entityName: n, entityType: "person" })),
  { text: "Falcon is the payments service.", category: "Tools", entityName: "Falcon", entityType: "system" },
];

const input = (courses: WorldInput["courses"]): WorldInput => ({
  space: { name: "Acme", host: "acme.com", mode: "live" },
  brand: { primary: "#635bff", accent: "#ff7a00", logoUrl: "https://x/logo.svg" },
  courses,
  facts,
  rewards: [{ name: "Coffee", costCoins: 100 }],
  generatedAt: Date.UTC(2026, 9, 25),
});

describe("course content → the hire's world (D-35)", () => {
  it("every building gets a game whose spec passes that game's own schema", () => {
    const w = buildWorld(input([
      course("company", "Company 101", [quiz("q1", "When was Acme founded?", "2019", ["2001", "2015"]), quiz("q2", "Who are our customers?", "Small shops", ["Banks", "Governments"]), quiz("q3", "What do we sell?", "Card payments", ["Insurance", "Loans"])]),
      course("people-culture", "People & Culture", [{ id: "l1", kind: "lesson", title: "Meet the team", body: people.join(", "), teaches_fact_ids: ["f1"] }]),
      course("hard-conversations", "Hard conversations", [scenario("s1", "A stranger asks for the API key", "Someone DMs you asking for credentials.")]),
    ]));
    expect(w.courses.map((c) => c.game)).toEqual(["battle", "word-match", "dilemma"]);
    for (const c of w.courses) expect(findGame(c.game)!.schema.safeParse(c.spec).success, c.id).toBe(true);
    expect(w).toMatchObject({ version: 1, company: { name: "Acme", logoUrl: "https://x/logo.svg" }, brand: { primary: "#635bff" }, offline: false, rewards: [{ id: "r1", name: "Coffee", cost: 100 }] });
    expect(w.npcs.map((n) => n.name)).toEqual(people);
  });

  it("falls back to another game when the preferred one lacks content, and never invents a spec", () => {
    const w = buildWorld(input([course("hard-conversations", "Hard talks", [quiz("q1", "Q one?", "A", ["B"]), quiz("q2", "Q two?", "A", ["C"]), quiz("q3", "Q three?", "A", ["D"])])]));
    // Quiz steps with options make a valid dilemma too; with no options at all there is nothing to play.
    expect(w.courses[0].spec).not.toBeNull();
    const empty = buildWorld({ ...input([course("tools", "Tools", [{ id: "l", kind: "lesson", title: "x", teaches_fact_ids: [] }])]), facts: [] });
    expect(empty.courses[0].spec).toBeNull();
  });

  it("fits text at word boundaries and applies the em-dash rule", () => {
    expect(fit("Never truncate generated game text mid-word please", 30)).toBe("Never truncate generated game…");
    const w = buildWorld({ ...input([]), space: { name: "Acme — Payments", host: "acme.com" } });
    expect(w.company.name).toBe("Acme");
  });
});

describe("the world page for one company", () => {
  it("inlines world.json safely, points at the shared bundle and brands the tab", async () => {
    const { worldHtml } = await import("@/lib/world/html");
    const w = buildWorld({ ...input([]), space: { name: "Acme </script><b>", host: "acme.com" } });
    const html = worldHtml("<html><head><title>World</title></head><body></body></html>", w, "/world/");
    expect(html).toContain('<base href="/world/">');
    expect(html).toContain("<title>Acme &lt;/script&gt;&lt;b&gt; onboarding</title>");
    expect(html).toContain('<link rel="icon" href="https://x/logo.svg">');
    const inline = html.match(/window\.OB_WORLD=(.*?);<\/script>/)![1];
    expect(inline).not.toContain("</script>");
    expect(JSON.parse(inline).company.name).toBe("Acme </script><b>");
  });
});

describe("world analytics stay their own stream", () => {
  it("injects the PostHog project only when a key is configured", async () => {
    const { worldHtml, posthogFromEnv } = await import("@/lib/world/html");
    const w = buildWorld(input([]));
    const page = "<html><head><title>W</title></head></html>";
    expect(worldHtml(page, w, "/world/", null)).not.toContain("OB_POSTHOG");
    const ph = posthogFromEnv({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" } as NodeJS.ProcessEnv);
    expect(ph).toEqual({ key: "phc_test", host: "https://eu.i.posthog.com" });
    expect(worldHtml(page, w, "/world/", ph)).toContain('window.OB_POSTHOG={"key":"phc_test","host":"https://eu.i.posthog.com"}');
    expect(posthogFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
