import { STAGE_LABELS } from "@/lib/pipeline/labels";

type State = "done" | "active" | "waiting" | "failed" | "stalled" | "todo";

/** The pipeline as a track of stations. Used on the sign-in page and above each project. */
export function StageTrack({ states, compact = false }: { states: Partial<Record<string, State>>; compact?: boolean }) {
  return (
    <ol className="flex w-full items-start" aria-label="Pipeline stages">
      {STAGE_LABELS.map((s, i) => {
        const st = states[s.key] ?? "todo";
        const fill =
          st === "done" ? "var(--g-ink)" : st === "active" ? "var(--g-marigold)" : st === "waiting" ? "var(--g-marigold)" : st === "failed" || st === "stalled" ? "var(--g-danger)" : "var(--g-surface)";
        return (
          <li key={s.key} className="relative flex flex-1 flex-col items-center text-center" data-testid={`stage-${s.key}`} data-state={st}>
            {i > 0 && <span aria-hidden className="absolute top-[9px] right-1/2 h-[2px] w-full" style={{ background: st === "todo" ? "var(--g-line)" : "var(--g-ink)" }} />}
            <span
              aria-hidden
              className={`relative z-10 block h-5 w-5 rounded-full border-2 ${st === "active" ? "animate-pulse" : ""}`}
              style={{ background: fill, borderColor: st === "todo" ? "var(--g-line)" : "var(--g-ink)" }}
            />
            {!compact && <span className={`mt-2 px-0.5 text-[11px] leading-tight sm:text-xs ${st === "todo" ? "g-muted" : ""}`}>{s.short}</span>}
            <span className="sr-only">{`${s.label}: ${st}`}</span>
          </li>
        );
      })}
    </ol>
  );
}
