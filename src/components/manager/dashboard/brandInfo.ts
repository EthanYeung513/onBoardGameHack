import { initials } from "@/components/manager/brand";
import type { Space } from "./shared";

// The mockup's `B` object (company, host, initials, primary, accent, bg, style) built from the
// space and its real brand_profiles row. `null` palette fields mean "no brand learned yet".

const luminance = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

export function brandInfo(space: Space) {
  const b = space.brand;
  const hex = (role: "primary" | "accent" | "surface" | "text") => b?.palette.find((p) => p.role === role)?.hex ?? null;
  // The preview hero is dark with white copy (mockup `B.bg`): the brand's dark surface, else its text colour.
  const surface = hex("surface");
  const bg = surface && luminance(surface) < 0.4 ? surface : (hex("text") ?? surface);
  const notes = b?.typography.notes?.trim();
  const style = b ? (notes && notes.length <= 40 ? notes : b.typography.heading.family) : null;
  return {
    company: space.name,
    host: space.host,
    initials: initials(space.name),
    primary: hex("primary"),
    accent: hex("accent"),
    bg,
    style,
    hasBrand: Boolean(b),
  };
}

export type BrandInfo = ReturnType<typeof brandInfo>;
