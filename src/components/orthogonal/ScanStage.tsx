"use client";

import { useEffect } from "react";
import type { ScanResult } from "@/lib/orthogonal/types";
import { LiveProgress } from "./LiveProgress";
import { BrowserDots, LogLine, Logo } from "./ui";
import { useTicker } from "./useTicker";

interface Props {
  siteUrl: string;
  /** Null while the scan request is in flight. */
  scan: ScanResult | null;
  /** Multiplier on every delay (1 = cinematic). */
  speed: number;
  onDone: () => void;
  onRetry?: () => void;
}

/** Plays back the scan log line by line while a wireframe of the site assembles on the right. */
export function ScanStage({ siteUrl, scan, speed, onDone, onRetry }: Props) {
  // A live backend reports status and keeps the log growing; an instant one is played back line by line.
  const live = scan?.status !== undefined;
  const log = scan?.log ?? [];
  const n = useTicker(scan && !live ? log.length : null, 1500 * speed, 2100 * speed, onDone);
  const ready = scan?.status === "ready";
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(onDone, 1800 * speed);
    return () => clearTimeout(t);
  }, [ready, speed, onDone]);
  const pct = log.length ? Math.round((n / log.length) * 100) : 0;
  const surface = scan?.palette.find((c) => c.role === "surface")?.hex ?? "#FBF7EE";
  const ink = scan?.palette.find((c) => c.role === "primary")?.hex ?? "#0F3D2E";

  if (live && scan) {
    return (
      <LiveProgress
        siteUrl={scan.siteUrl}
        trail="scanning"
        heading={
          <>
            Reading your
            <br />
            website.
          </>
        }
        lines={log}
        finished={ready}
        progress={scan.progress ?? 0}
        blocks={scan.skeleton}
        surface={surface}
        ink={ink}
        error={scan.status === "failed" ? scan.error : undefined}
        onRetry={onRetry}
        studioUrl={scan.studioUrl}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col gap-10 px-5 py-7 md:px-11">
      <Logo trail={<span className="ml-1.5">/ scanning</span>} />
      <div className="grid flex-1 items-start gap-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <div className="inline-flex items-center gap-3 rounded-full bg-white py-2.5 pr-[18px] pl-3 text-base font-semibold text-carbon">
            <span aria-hidden className="inline-block size-[18px] animate-spinner rounded-full border-[2.5px] border-azure border-t-transparent" />
            {siteUrl}
          </div>
          <h2 className="mt-9 mb-[18px] text-[clamp(36px,4.5vw,60px)] leading-none font-semibold tracking-[-.02em]">
            Reading your
            <br />
            website.
          </h2>
          <div
            role="progressbar"
            aria-label="Scan progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 max-w-[420px] overflow-hidden rounded-[3px] bg-white/12"
          >
            <div className="h-full rounded-[3px] bg-azure transition-[width] duration-900 ease-in-out" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-7 flex list-none flex-col gap-3 p-0 text-[15px]">
            {log.slice(0, Math.min(n + 1, log.length)).map((text, i) => (
              <LogLine key={i} text={text} done={i < n} />
            ))}
          </ul>
        </div>

        <div className="rounded-[18px] border border-white/8 bg-graphite p-3.5">
          <div className="mb-3 flex gap-1.5">
            <BrowserDots />
          </div>
          <div className="flex min-h-[420px] flex-col gap-3.5 rounded-xl p-[22px]" style={{ background: surface, color: ink }}>
            {scan?.skeleton.slice(0, Math.max(0, n - 1)).map((b) => (
              <div
                key={b.label}
                className="flex animate-pop items-center rounded-lg px-3.5 text-[13px] font-semibold"
                style={{ height: b.height, width: `${b.width}%`, background: b.bg, color: b.fg }}
              >
                {b.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
