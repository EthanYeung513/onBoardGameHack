/**
 * Battle creatures. The default is emoji (licence-safe). Set NEXT_PUBLIC_SPRITE_SOURCE=pokeapi to use Gen V
 * animated sprites for the fan-project demo only: Pokémon is Nintendo/Game Freak/Creatures IP (PLAN.md §4).
 */
const POKEAPI_IDS: Record<string, number> = {
  townhall: 143,
  security: 137,
  support: 113,
  engineering: 81,
  annex: 133,
  wild: 129,
};
const EMOJI: Record<string, string> = {
  townhall: "🏛️",
  security: "🛡️",
  support: "💬",
  engineering: "⚙️",
  annex: "📦",
  wild: "🎣",
};

export const spriteSource = process.env.NEXT_PUBLIC_SPRITE_SOURCE === "pokeapi" ? "pokeapi" : "cc0";

export function Creature({ kind, size = 96, flash = false }: { kind: string; size?: number; flash?: boolean }) {
  const id = POKEAPI_IDS[kind];
  const className = `select-none ${flash ? "animate-pulse" : ""}`;
  if (spriteSource === "pokeapi" && id) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote animated GIFs; next/image would re-encode them
      <img
        src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${id}.gif`}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ imageRendering: "pixelated" }}
      />
    );
  }
  return (
    <span aria-hidden className={className} style={{ fontSize: size * 0.7, lineHeight: 1 }}>
      {EMOJI[kind] ?? "❓"}
    </span>
  );
}
