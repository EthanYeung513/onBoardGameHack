import type { CSSProperties, ReactNode } from "react";
import type { ScanResult } from "@/lib/orthogonal/types";
import { Logo } from "./ui";

/** Each card pops in 100 ms after the previous one. */
const delay = (i: number): CSSProperties => ({ animationDelay: `${i * 0.1}s` });

function Card({ i, className, label, labelClass, children }: { i: number; className: string; label: string; labelClass: string; children: ReactNode }) {
  return (
    <section className={`animate-pop rounded-[18px] p-[22px] ${className}`} style={delay(i)}>
      <h3 className={`mt-0 mb-3.5 text-[13px] font-semibold ${labelClass}`}>{label}</h3>
      {children}
    </section>
  );
}

/** "What we found": the scan result, laid out as cards, with the button that starts the build. */
export function ExtractStage({ scan, onBuild, busy, error }: { scan: ScanResult; onBuild: () => void; busy: boolean; error: string | null }) {
  const { typography: type } = scan;
  return (
    <div className="flex min-h-screen flex-col gap-8 px-5 pt-7 pb-15 md:px-11">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Logo trail={<span className="ml-1.5">/ {scan.siteUrl}</span>} />
        <div className="flex flex-wrap items-center gap-4">
          {error && (
            <p role="alert" className="m-0 text-sm text-coral">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onBuild}
            disabled={busy}
            className="h-[50px] cursor-pointer rounded-xl border-0 bg-azure px-6 text-base font-semibold text-white hover:bg-azure-deep disabled:cursor-wait disabled:opacity-70"
          >
            Build the onboarding →
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2.5 text-[13px] font-semibold text-marigold">Step 4 of 4 · What we found</div>
        <h2 className="m-0 text-[clamp(34px,4vw,52px)] leading-none font-semibold tracking-[-.02em]">{scan.siteName}, understood.</h2>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
        <Card i={0} className="bg-white text-carbon" label="Palette" labelClass="text-black/50">
          <div className="mb-3.5 flex gap-2">
            {scan.palette.map((c) => (
              <div key={c.hex} className="h-[72px] flex-1 rounded-[10px] border border-black/8" style={{ background: c.hex }} />
            ))}
          </div>
          <dl className="m-0 flex flex-col gap-1.5 font-code text-[13px]">
            {scan.palette.map((c) => (
              <div key={c.hex} className="flex justify-between">
                <dt>{c.name}</dt>
                <dd className="m-0 text-black/50">{c.hex}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card i={1} className="bg-white text-carbon" label="Typography" labelClass="text-black/50">
          <div className="text-[34px] leading-none font-semibold tracking-[-.02em]">{type.heading.family}</div>
          <div className="mt-1.5 text-sm text-black/55">Headings · {type.heading.weight}</div>
          <div className="mt-[18px] text-[22px] leading-none">{type.body.family}</div>
          <div className="mt-1.5 text-sm text-black/55">
            Body · {type.body.weight}
            {type.body.metrics && ` · ${type.body.metrics}`}
          </div>
          <div className="mt-[18px] border-t border-black/8 pt-3.5 text-sm text-black/65">{type.notes}</div>
        </Card>

        <Card i={2} className="bg-white text-carbon" label={`Features · ${scan.features.length}`} labelClass="text-black/50">
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px]">
            {scan.features.map((f) => (
              <li key={f} className="flex items-baseline gap-2.5">
                <span aria-hidden className="relative -top-px size-2 shrink-0 rounded-full bg-azure" />
                {f}
              </li>
            ))}
          </ul>
        </Card>

        <Card i={3} className="bg-coral text-white" label="Onboarding ideas" labelClass="text-white/75">
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[17px] leading-[1.3] font-medium">
            {scan.ideas.map((idea) => (
              <li key={idea}>{idea}</li>
            ))}
          </ul>
        </Card>

        <Card i={4} className="bg-azure text-white" label="Site" labelClass="text-white/75">
          <div className="text-[40px] leading-none font-semibold tracking-[-.02em]">{scan.pageCount} pages</div>
          <p className="mt-2.5 mb-0 text-[15px] leading-[1.45]">{scan.summary}</p>
          <p className="mt-4 mb-0 text-sm text-white/80">Tone: {scan.tone}.</p>
        </Card>

        <Card i={5} className="bg-marigold text-carbon" label="Proposed structure" labelClass="text-black/55">
          <div className="text-[40px] leading-none font-semibold tracking-[-.02em]">{scan.structure.outline.length} steps</div>
          <p className="mt-2.5 mb-0 text-[15px] leading-[1.45]">
            {scan.structure.outline.join(" → ")}. {scan.structure.duration}.
          </p>
        </Card>
      </div>
    </div>
  );
}
