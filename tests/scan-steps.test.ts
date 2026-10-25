import { describe, expect, it } from "vitest";
import { scanView, WAITING_MS, type ScanEvent, type ScanInput, type ScanJob } from "@/components/manager/scanSteps";

const NOW = 1_000_000;
let n = 0;
const job = (stage: ScanJob["stage"], status: ScanJob["status"], over: Partial<ScanJob> = {}): ScanJob => ({
  id: `j${n++}`,
  stage,
  status,
  progress: status === "succeeded" ? 1 : 0,
  attempt: 0,
  error: null,
  queuedAt: NOW - 5000,
  startedAt: status === "queued" ? null : NOW - 4000,
  ...over,
});
const ev = (stage: ScanEvent["stage"], level: ScanEvent["level"], message: string, pages: number | null = null): ScanEvent => ({
  id: `e${n++}`, at: NOW, stage, level, message, pages,
});
const input = (jobs: ScanJob[], events: ScanEvent[] = [], over: Partial<ScanInput> = {}): ScanInput => ({
  scan: { status: "running", progress: 0, pageCount: 0 },
  jobs,
  events,
  stalled: false,
  ...over,
});
const states = (v: ReturnType<typeof scanView>) => v.steps.map((s) => s.state);

describe("scan step mapping (space.html SCAN_STEPS from live jobs)", () => {
  it("starts on 'Resolving {host}' with the mockup copy and an unknown page count", () => {
    const v = scanView(input([job("crawl", "queued")]), "acme.com", NOW);
    expect(v.steps.map((s) => s.text)).toEqual([
      "Resolving acme.com",
      "Found … pages via sitemap.xml",
      "Extracting brand identity (logo, colors, typography)",
      "Reading public pages — about, careers, blog",
      "Building company knowledge graph",
      "Calibrating dashboard to your brand",
    ]);
    expect(states(v)).toEqual(["active", "", "", "", "", ""]);
    expect(v.phase).toBe("running");
  });

  it("lights the sitemap line with the real page count and streams the latest event under it", () => {
    const v = scanView(input([job("crawl", "running", { progress: 0.3 })], [ev("crawl", "info", "Found 14 pages via sitemap.xml", 14), ev("crawl", "info", "Fetched /about")]), "acme.com", NOW);
    expect(v.steps[1].text).toBe("Found 14 pages via sitemap.xml");
    expect(states(v)).toEqual(["done", "active", "", "", "", ""]);
    expect(v.steps[1].note).toEqual({ kind: "log", text: "Fetched /about" });
    expect(v.progress).toBeCloseTo(0.3 / 6);
  });

  it("walks the chain in mockup order and fills the bar from real stage progress", () => {
    const v = scanView(
      input([job("crawl", "succeeded"), job("extract_design", "succeeded"), job("analyse", "succeeded"), job("seed_brain", "running", { progress: 0.5 })], [], {
        scan: { status: "running", progress: 0.5, pageCount: 9 },
      }),
      "acme.com",
      NOW,
    );
    expect(states(v)).toEqual(["done", "done", "done", "done", "active", ""]);
    expect(v.steps[1].text).toBe("Found 9 pages via sitemap.xml");
    expect(v.progress).toBeCloseTo(3.5 / 6);
  });

  it("shows the warn event while a stage is retrying", () => {
    const v = scanView(
      input([job("crawl", "succeeded"), job("extract_design", "queued", { attempt: 1, error: "timeout", startedAt: NOW - 3000 })], [
        ev("extract_design", "warn", "Extracting brand identity failed (attempt 1 of 3), retrying in 2s: timeout"),
      ]),
      "acme.com",
      NOW,
    );
    expect(v.phase).toBe("retrying");
    expect(v.steps[2].note).toEqual({ kind: "warn", text: "Extracting brand identity failed (attempt 1 of 3), retrying in 2s: timeout" });
  });

  it("offers Retry on the failed job with a readable error", () => {
    const failed = job("crawl", "failed", { error: "acme.com did not respond" });
    const v = scanView(input([failed], [], { scan: { status: "failed", progress: 0, pageCount: 0, error: "acme.com did not respond" } }), "acme.com", NOW);
    expect(v.phase).toBe("failed");
    expect(v.resumeJobId).toBe(failed.id);
    expect(v.steps[0].note).toEqual({ kind: "error", text: "acme.com did not respond" });
  });

  it("detects a stall; Resume only targets a job the watchdog has marked stalled", () => {
    const running = job("crawl", "running", { progress: 0.2 });
    const silent = scanView(input([running], [], { stalled: true }), "acme.com", NOW);
    expect(silent.phase).toBe("stalled");
    expect(silent.resumeJobId).toBeNull();
    const marked = job("crawl", "stalled", { progress: 0.2 });
    expect(scanView(input([marked]), "acme.com", NOW).resumeJobId).toBe(marked.id);
  });

  it("says honestly when no worker has picked a stage up, instead of spinning forever", () => {
    const jobs = [job("crawl", "succeeded"), job("extract_design", "queued", { queuedAt: NOW - WAITING_MS - 1 })];
    const v = scanView(input(jobs), "acme.com", NOW);
    expect(v.phase).toBe("waiting");
    expect(v.steps[2].note?.kind).toBe("waiting");
    expect(v.steps[2].note?.text).toContain("Extracting brand identity");
    expect(scanView(input([job("crawl", "succeeded"), job("extract_design", "queued")]), "acme.com", NOW).phase).toBe("running");
  });

  it("marks every line done and the bar full on success", () => {
    const v = scanView(input([job("ready", "succeeded")], [], { scan: { status: "succeeded", progress: 1, pageCount: 3 } }), "acme.com", NOW);
    expect(states(v)).toEqual(Array(6).fill("done"));
    expect(v.progress).toBe(1);
    expect(v.phase).toBe("succeeded");
  });
});
