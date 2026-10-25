import { OrthogonalMark } from "@/components/brand/OrthogonalMark";

/** Orthogonal's own mark (product chrome, not a customer colour). */
export function Logo({ size = 26, light = false }: { size?: number; light?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 22, color: light ? "#fff" : "inherit" }}>
      <OrthogonalMark size={size} />
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
