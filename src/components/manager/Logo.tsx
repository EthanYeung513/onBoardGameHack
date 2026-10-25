/** Orthogonal's own mark (product chrome, not a customer colour). */
export function Logo({ size = 26, light = false }: { size?: number; light?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 22, color: light ? "#fff" : "inherit" }}>
      <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden>
        <rect x="0" y="0" width="10" height="10" rx="3" fill="#2f6bff" />
        <circle cx="19" cy="5" r="6" fill="#ff5c39" />
        <rect x="12" y="12" width="10" height="10" rx="3" fill="#ffb31f" />
        <circle cx="5" cy="19" r="5" fill="#0e9f6e" />
      </svg>
      Orthogonal
    </span>
  );
}

/** The left half of space.html's split pages: logo over the looping hero video. */
export function SplitHero() {
  return (
    <div className="left">
      <div className="logo">
        <Logo light />
      </div>
      <video autoPlay loop muted playsInline>
        <source src="/assets/web-hero.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
