import type { ReactNode } from "react";
import { OrthogonalMark } from "@/components/brand/OrthogonalMark";

/** Shared pieces of the Orthogonal UI. Static styling is Tailwind; colours that come from data are inline styles. */

export function Diamond({ size, color = "var(--color-marigold)", className = "" }: { size: number; color?: string; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rotate-45 ${className}`} style={{ width: size, height: size, background: color }} />;
}

export function Logo({ size = 18, trail }: { size?: number; trail?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 font-bold" style={{ fontSize: size }}>
      <OrthogonalMark size={Math.round(size * 1.1)} />
      Orthogonal
      {trail && <span className="font-normal whitespace-nowrap text-white/45">{trail}</span>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-[11px] font-bold tracking-[.08em] text-white/45 uppercase">{children}</div>;
}

/** One line of an agent log: a check once done, an empty dot while in progress. */
export function LogLine({ text, done, size = "md" }: { text: string; done: boolean; size?: "sm" | "md" }) {
  const dot = size === "sm" ? "mt-px size-[18px] text-[10px]" : "size-5 text-[11px]";
  return (
    <li className={`flex animate-fade-up gap-3 ${size === "sm" ? "items-start" : "items-center"}`}>
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-carbon ${dot} ${done ? "bg-marigold" : "bg-white/15"}`}
      >
        {done ? "✓" : ""}
      </span>
      <span className={`leading-snug ${done ? "text-white" : "text-white/50"}`}>{text}</span>
    </li>
  );
}

/** Pill filter chip used for asset categories and step kinds. */
export function Chip({ selected, onClick, children, className = "" }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`cursor-pointer rounded-full border text-xs font-semibold ${selected ? "border-marigold bg-marigold text-carbon" : "border-white/16 text-white/80"} ${className}`}
    >
      {children}
    </button>
  );
}

/** 40×24 switch. `bg` and `knob` let previews draw it in a step's own colours. */
export function SwitchTrack({ on, bg, knob = "#fff" }: { on: boolean; bg: string; knob?: string }) {
  return (
    <span aria-hidden className="relative inline-block h-6 w-10 shrink-0 rounded-xl" style={{ background: bg }}>
      <span className="absolute top-[3px] size-[18px] rounded-full transition-[left] duration-200" style={{ background: knob, left: on ? 19 : 3 }} />
    </span>
  );
}

export function BrowserDots({ size = 10 }: { size?: number }) {
  return (
    <>
      {["bg-coral", "bg-marigold", "bg-azure"].map((c) => (
        <span key={c} aria-hidden className={`inline-block rounded-full ${c}`} style={{ width: size, height: size }} />
      ))}
    </>
  );
}
