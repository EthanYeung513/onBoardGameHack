// Runtime Stardew-style logo: spells any company name with the wooden plank
// alphabet in public/assets/logo_kit.png (built from the real SDV logo by
// tools/title_assets.py — real letters + letters assembled from real planks,
// golden key-art palette, real leaf sprites). Returns a native-res canvas;
// scale it up with image-rendering: pixelated.

interface Kit {
  height: number;
  glyphs: Record<string, [number, number, number, number]>;
  leaves: { rect: [number, number, number, number]; line: 0 | 1; anchor: 'start' | 'end'; dx: number; dy: number }[];
}

const GAP = 3;          // px between letters (the real logo's spacing)
const SPACE = 22;       // word gap
const LINE_GAP = 23;    // between the two lines (real logo: 97 -> 120)
const SHADOW = { dx: -3, dy: 4, color: 'rgba(8, 24, 64, 0.42)' };

let kitP: Promise<{ img: HTMLImageElement; kit: Kit }> | null = null;
function loadKit() {
  kitP ??= Promise.all([
    fetch('assets/logo_kit.json').then(r => r.json() as Promise<Kit>),
    new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = 'assets/logo_kit.png';
    }),
  ]).then(([kit, img]) => ({ img, kit }));
  return kitP;
}

/** Long multi-word names go on two lines, split as evenly as possible. */
export function splitLines(name: string): string[] {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.join(' ').length <= 10) return [words.join(' ')];
  let best = [words.join(' ')], score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const s = Math.max(a.length, b.length);
    if (s < score) { score = s; best = [a, b]; }
  }
  return best;
}

let kitData: ImageData | null = null;
function kitPixels(img: HTMLImageElement) {
  if (!kitData) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    kitData = x.getImageData(0, 0, img.width, img.height);
  }
  return kitData;
}

type Piece = { kind: 'glyph'; ch: string; x: number; w: number } | { kind: 'text'; ch: string; x: number; w: number };

export async function renderLogo(name: string): Promise<HTMLCanvasElement> {
  const { img, kit } = await loadKit();
  const H = kit.height;
  const measure = document.createElement('canvas').getContext('2d')!;
  // characters without a plank glyph (digits, &, ...) fall back to the SDV font
  const font = `${Math.round(H * 1.5)}px Stardew, serif`;
  measure.font = font;

  const lines = splitLines(name || ' ').map(text => {
    const pieces: Piece[] = [];
    let x = 0;
    for (const ch of text) {
      if (ch === ' ') { x += SPACE; continue; }
      const g = kit.glyphs[ch];
      if (g) { pieces.push({ kind: 'glyph', ch, x, w: g[2] }); x += g[2] + GAP; }
      else {
        const w = Math.ceil(measure.measureText(ch).width);
        pieces.push({ kind: 'text', ch, x, w }); x += w + GAP;
      }
    }
    return { pieces, width: Math.max(1, x - GAP) };
  });

  const maxW = Math.max(...lines.map(l => l.width));
  const PAD = 30; // room for leaves + shadow
  const cw = maxW + PAD * 2, ch = lines.length * H + (lines.length - 1) * LINE_GAP + PAD * 2;
  const layer = document.createElement('canvas');
  layer.width = cw; layer.height = ch;
  const g = layer.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;

  const starts: number[] = [], ends: number[] = [], tops: number[] = [];
  lines.forEach((l, li) => {
    const ox = PAD + Math.round((maxW - l.width) / 2), oy = PAD + li * (H + LINE_GAP);
    starts.push(ox); ends.push(ox + l.width); tops.push(oy);
    for (const p of l.pieces) {
      if (p.kind === 'glyph') {
        const [sx, sy, sw, sh] = kit.glyphs[p.ch];
        g.drawImage(img, sx, sy, sw, sh, ox + p.x, oy, sw, sh);
      } else {
        g.font = font; g.textBaseline = 'bottom';
        g.lineWidth = 6; g.lineJoin = "round"; g.strokeStyle = '#403017'; g.fillStyle = '#dda22b';
        g.strokeText(p.ch, ox + p.x, oy + H + 6); g.fillText(p.ch, ox + p.x, oy + H + 6);
      }
    }
  });

  // leaves where the real logo has them (single line: line-1 leaves + the
  // closing leaf from the second line)
  // Different letters have different silhouettes than S/W/Y, so each leaf is
  // nudged toward the text until it actually overlaps a letter.
  const letters = g.getImageData(0, 0, cw, ch).data;
  const kitPx = kitPixels(img);
  const overlap = (lx: number, ly: number, r: [number, number, number, number]) => {
    let n = 0;
    for (let y = 0; y < r[3]; y++) for (let x = 0; x < r[2]; x++) {
      const X = lx + x, Y = ly + y;
      if (X < 0 || Y < 0 || X >= cw || Y >= ch) continue;
      if (kitPx.data[((r[1] + y) * kitPx.width + r[0] + x) * 4 + 3] && letters[(Y * cw + X) * 4 + 3]) n++;
    }
    return n;
  };
  for (const lf of kit.leaves) {
    let li: number = lf.line;
    if (lines.length === 1) {
      if (lf.line === 1 && lf.anchor === 'start') continue;
      li = 0;
    }
    const base = lf.anchor === 'start' ? starts[li] : ends[li];
    const [sx, sy, sw, sh] = lf.rect;
    let x = base + lf.dx, y = tops[li] + lf.dy;
    const step = lf.anchor === 'start' ? 1 : -1;
    for (let k = 0; k < 24 && overlap(x, y, lf.rect) < 8; k++) { x += step; if (k % 2) y += 1; }
    g.drawImage(img, sx, sy, sw, sh, x, y, sw, sh);
  }

  // drop shadow (down-left, like the key-art logo), then the letters on top
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const o = out.getContext('2d')!;
  o.imageSmoothingEnabled = false;
  const sh = document.createElement('canvas');
  sh.width = cw; sh.height = ch;
  const s = sh.getContext('2d')!;
  s.drawImage(layer, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = SHADOW.color;
  s.fillRect(0, 0, cw, ch);
  o.drawImage(sh, SHADOW.dx, SHADOW.dy);
  o.drawImage(layer, 0, 0);
  return out;
}
