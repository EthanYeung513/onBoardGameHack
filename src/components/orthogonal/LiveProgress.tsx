"use client";

import type { ReactNode } from "react";
import type { SkeletonBlock } from "@/lib/orthogonal/types";
import { BrowserDots, LogLine, Logo } from "./ui";

interface Props {
  siteUrl: string;
  trail: string;
  heading: ReactNode;
  /** Every line so far; the last one is still running unless `finished`. */
  lines: string[];
  finished: boolean;
  /** 0 to 1. */
  progress: number;
  blocks: SkeletonBlock[];
  surface: string;
  ink: string;
  error?: string;
  onRetry?: () => void;
  studioUrl?: string;
}

/** Progress from a live backend: real pipeline events as they happen, with Retry when a stage fails. */
export function LiveProgress({ siteUrl, trail, heading, lines, finished, progress, blocks, surface, ink, error, onRetry, studioUrl }: Props) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className="flex min-h-screen flex-col gap-10 px-5 py-7 md:px-11">
      <Logo trail={<span className="ml-1.5">/ {trail}</span>} />
      <div className="grid flex-1 items-start gap-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <div className="inline-flex items-center gap-3 rounded-full bg-white py-2.5 pr-[18px] pl-3 text-base font-semibold text-carbon">
            {!error && !finished && <span aria-hidden className="inline-block size-[18px] animate-spinner rounded-full border-[2.5px] border-azure border-t-transparent" />}
            {siteUrl}
          </div>
          <h2 className="mt-9 mb-[18px] text-[clamp(36px,4.5vw,60px)] leading-none font-semibold tracking-[-.02em]">{heading}</h2>
          <div role="progressbar" aria-label="Progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1.5 max-w-[420px] overflow-hidden rounded-[3px] bg-white/12">
            <div className={`h-full rounded-[3px] transition-[width] duration-900 ease-in-out ${error ? "bg-coral" : "bg-azure"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
          <ul className="mt-7 flex list-none flex-col gap-3 p-0 text-[15px]" aria-live="polite" data-testid="live-log">
            {lines.map((text, i) => (
              <LogLine key={i} text={text} done={finished || i < lines.length - 1 || Boolean(error)} />
            ))}
          </ul>
          {error && (
            <div role="alert" className="mt-7 max-w-[520px] rounded-xl bg-white/8 p-4 text-[15px]">
              <p className="m-0 mb-3 text-coral">{error}</p>
              <div className="flex flex-wrap gap-2.5">
                {onRetry && (
                  <button type="button" onClick={onRetry} className="h-10 cursor-pointer rounded-[10px] border-0 bg-azure px-4 font-semibold text-white">
                    Retry
                  </button>
                )}
                {studioUrl && (
                  <a href={studioUrl} className="inline-flex h-10 items-center rounded-[10px] border border-white/20 px-4 font-semibold text-white">
                    Open in studio
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="rounded-[18px] border border-white/8 bg-graphite p-3.5">
          <div className="mb-3 flex gap-1.5">
            <BrowserDots />
          </div>
          <div className="flex min-h-[420px] flex-col gap-3.5 rounded-xl p-[22px]" style={{ background: surface, color: ink }}>
            {blocks.map((b) => (
              <div key={b.label} className="flex animate-pop items-center rounded-lg px-3.5 text-[13px] font-semibold" style={{ height: b.height, width: `${b.width}%`, background: b.bg, color: b.fg }}>
                {b.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
