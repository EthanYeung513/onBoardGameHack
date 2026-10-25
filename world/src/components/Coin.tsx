// Blue hexagonal "C" credit coin, drawn as pixel art (14x16) in the Stardew
// style: dark outline, bevel lit from the top-left, raised C with a shadow.
const W = 14, H = 16, CX = 6.5, CY = 7.5;
// half-width per row: the slanted edges step 2px per row (a 30deg hex)
const HALF = [1, 3, 5, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 5, 3, 1];
const C_GLYPH = ['.####.', '##..##', '##....', '##....', '##....', '##....', '##..##', '.####.'];
const COL = { o: '#17295e', L: '#a8d8ff', d: '#1f4c9e', m: '#3479d6', hi: '#5c9ff0', c: '#f2f9ff', s: '#163a80' };

function pixels() {
  const inside = (x: number, y: number) => y >= 0 && y < H && Math.abs(x + 0.5 - (CX + 0.5)) <= HALF[y];
  const out: { x: number; y: number; c: string }[] = [];
  const glyph = (x: number, y: number) => C_GLYPH[y - 4]?.[x - 4] === '#';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const edge = n4.some(([dx, dy]) => !inside(x + dx, y + dy));
    const ring = !edge && n4.some(([dx, dy]) => n4.some(([ex, ey]) => !inside(x + dx + ex, y + dy + ey)));
    let c = COL.m;
    if (edge) c = COL.o;
    else if (ring) c = (x - CX) + (y - CY) * 0.9 < 0 ? COL.L : COL.d;
    else if (glyph(x, y)) c = COL.c;
    else if (glyph(x - 1, y - 1)) c = COL.s;
    else if (x + y < 9) c = COL.hi; // soft sheen in the top-left
    out.push({ x, y, c });
  }
  return out;
}
const PX = pixels();

export default function Coin({ size = 20 }: { size?: number }) {
  return (
    <svg className="coin" width={size * W / H} height={size} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" aria-hidden>
      {PX.map(p => <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.c} />)}
    </svg>
  );
}
