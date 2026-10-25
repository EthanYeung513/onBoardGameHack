// The Orthogonal brand mark: four rounded squares (blue, red, green, yellow). Vector-traced from
// the product owner's asset (public/assets/orthogonal-logo.png, 70×84) — geometry fitted to the
// PNG (mean deviation 1.7/255) so it stays crisp at any density and has no white edge halo on
// dark surfaces. public/assets/orthogonal-mark.svg is the same drawing for static pages.

export const MARK_COLORS = { blue: "#3A97FA", red: "#F86748", green: "#4EC77D", yellow: "#FCC836" } as const;

export function OrthogonalMark({ size = 26, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 39 39" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="18.4" height="18.4" rx="4" fill={MARK_COLORS.blue} />
      <rect x="20.6" width="18.4" height="18.4" rx="4" fill={MARK_COLORS.red} />
      <rect y="20.6" width="18.4" height="18.4" rx="4" fill={MARK_COLORS.green} />
      <rect x="20.6" y="20.6" width="18.4" height="18.4" rx="4" fill={MARK_COLORS.yellow} />
    </svg>
  );
}
