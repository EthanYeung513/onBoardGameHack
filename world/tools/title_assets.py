"""Title-screen assets built from REAL Stardew Valley sprites (called by
build_real_assets.py; can also run standalone: python3 title_assets.py SRC OUT).

logo_kit.png + logo_kit.json
    A full A-Z alphabet of wooden plank letters in the style of the SDV logo,
    so the title can spell any company name at runtime (src/logo.ts).
    * S T A R D E W V L Y are the real letters cut out of LooseSprites/logo.png.
    * Every other letter is assembled from real plank pieces of those letters
      (stems, arms, bowls, diagonals, the R leg), then re-shaded with the
      logo's lighting (dark outline, highlight on top/right inner edge).
    * Recoloured from the sign-board orange to the golden key-art palette.
    * The green leaves are the real leaf sprites from the logo.

title_bg.png
    The real title-menu backdrop, layered the way TitleMenu.draw() does
    (Cursors sky gradient, Clouds big/small clouds, both Cursors mountain
    ranges, the dark corner bushes) plus a farm row in front composed from
    real sprites (fence, trees, bushes, coop, chickens, sunflowers, path).
"""
import json
import os
import sys

from PIL import Image

# ---------------------------------------------------------------- pixels ---
# Letters are handled as class grids so pieces can be flipped/rotated and
# re-lit. Classes: d outline, b grain/shade, # fill, c highlight, n/m/o nail.
CLASS = {
    (226, 122, 62): "#", (225, 121, 61): "#",
    (150, 71, 58): "b", (149, 70, 57): "b",
    (63, 15, 8): "d",
    (255, 190, 101): "c", (254, 189, 100): "c",
    (224, 198, 184): "n", (145, 124, 113): "m", (255, 243, 237): "o",
}
GOLD = {  # sampled from the golden SDV key-art logo
    "#": (221, 162, 43), "c": (253, 227, 63), "b": (149, 103, 25), "d": (64, 48, 23),
    "n": (232, 220, 206), "m": (146, 128, 112), "o": (255, 250, 240),
}
NAIL = set("nmo")


class G:
    """A piece/glyph: dict (x, y) -> class char."""

    def __init__(self, px=None):
        self.px = dict(px or {})

    @property
    def bbox(self):
        xs = [p[0] for p in self.px]
        ys = [p[1] for p in self.px]
        return min(xs), min(ys), max(xs), max(ys)

    def norm(self):
        x0, y0, _, _ = self.bbox
        return G({(x - x0, y - y0): c for (x, y), c in self.px.items()})

    def w(self):
        b = self.bbox
        return b[2] - b[0] + 1

    def h(self):
        b = self.bbox
        return b[3] - b[1] + 1

    def keep(self, fn):
        return G({p: c for p, c in self.px.items() if fn(*p)}).norm()

    def rect(self, x0, y0, x1, y1):
        return self.keep(lambda x, y: x0 <= x <= x1 and y0 <= y <= y1)

    def flip_h(self):
        W = self.w() - 1
        return G({(W - x, y): c for (x, y), c in self.norm().px.items()})

    def flip_v(self):
        H = self.h() - 1
        return G({(x, H - y): c for (x, y), c in self.norm().px.items()})

    def rot_cw(self):
        H = self.h() - 1
        return G({(H - y, x): c for (x, y), c in self.norm().px.items()})

    def stretch_v(self, new_h, at=None, band=6):
        """Lengthen by repeating a band of rows (keeps the grain texture)."""
        g = self.norm()
        H = g.h()
        at = H // 2 if at is None else at
        if new_h < H:  # shorten: drop a band of rows
            cut = H - new_h
            return G({(x, y if y < at else y - cut): c for (x, y), c in g.px.items()
                      if not (at <= y < at + cut)})
        if new_h == H:
            return g
        out = {}
        extra = new_h - H
        for (x, y), c in g.px.items():
            if y < at:
                out[(x, y)] = c
            else:
                out[(x, y + extra)] = c
        for k in range(extra):
            sy = at - band + (k % band)
            for x in range(g.w()):
                c = g.px.get((x, sy))
                if c and c not in NAIL:
                    out[(x, at + k)] = c
                elif c:
                    out[(x, at + k)] = "#"
        return G(out)

    def stretch_h(self, new_w, at=None, band=6):
        return self.rot_cw().stretch_v(new_w, None if at is None else at, band).rot_cw().rot_cw().rot_cw()

    def shift(self, dx, dy):
        return G({(x + dx, y + dy): c for (x, y), c in self.px.items()})

    def relight(self):
        """Re-derive outline + lighting from this piece's own silhouette, the
        way the logo is lit: dark outline all round, highlight on the inner
        top/right edge, shade on the inner left edge. Grain and nails stay."""
        m = self.px
        inside = lambda x, y: (x, y) in m
        border = {p for p in m if not all(inside(p[0] + dx, p[1] + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
        out = {}
        for (x, y), c in m.items():
            if (x, y) in border:
                out[(x, y)] = "d"
                continue
            if c in NAIL:
                out[(x, y)] = c
                continue
            if (x, y - 1) in border or (x + 1, y) in border:
                out[(x, y)] = "c"
            elif (x - 1, y) in border:
                out[(x, y)] = "b"
            elif c == "d":  # old outline now inside (after a cut/flip): grain
                out[(x, y)] = "b"
            elif c == "c" and any((x + dx, y + dy) in border for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2)):
                out[(x, y)] = "#"  # stale edge highlight from before a flip
            else:
                out[(x, y)] = c
        return G(out)


def compose(*parts):
    """parts: (piece, dx, dy); later parts sit on top (own outline wins)."""
    out = {}
    for g, dx, dy in parts:
        for (x, y), c in g.px.items():
            out[(x + dx, y + dy)] = c
    return G(out)


# ------------------------------------------------------- real glyph cut ---
def extract_letters(logo):
    px = logo.load()
    W, H = logo.size

    def isl(x, y):
        return 22 < x < 378 and 28 < y < 192 and px[x, y][:3] in CLASS

    seen, comps = set(), []
    for y in range(H):
        for x in range(W):
            if (x, y) in seen or not isl(x, y):
                continue
            st, pts = [(x, y)], []
            seen.add((x, y))
            while st:
                a, b = st.pop()
                pts.append((a, b))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        n = (a + dx, b + dy)
                        if n not in seen and isl(*n):
                            seen.add(n)
                            st.append(n)
            if len(pts) > 30:
                comps.append(pts)
    comps.sort(key=lambda pts: (min(p[1] for p in pts) > 110, min(p[0] for p in pts)))
    assert len(comps) == 13, f"expected 13 letters in logo.png, got {len(comps)}"
    letters = {}
    for ch, pts in zip("STARDEWVALLEY", comps):
        g = G({p: CLASS[px[p][:3]] for p in pts}).norm()
        letters.setdefault(ch, g)  # first occurrence (STARDEW A/E, first L)
    return letters


def build_alphabet(R):
    """R: real letters. Returns dict char -> relit G (baseline-aligned, h~64)."""
    T, E, D, Rr, V, L = R["T"], R["E"], R["D"], R["R"], R["V"], R["L"]
    HGT = 64
    # --- real plank pieces ---
    stem_t = T.rect(13, 3, 25, 62).relight()                 # T stem, 2 nails
    stem_e = E.rect(0, 0, 12, 63).relight()                  # E stem, 3 nails
    stem_d = D.rect(3, 0, 15, 63).relight()                  # D stem
    stem_l = L.rect(0, 0, 12, 63).relight()                  # L stem, 1 nail
    stem_r = Rr.rect(3, 0, 14, 62).relight()
    arm_top = E.rect(12, 0, 38, 11).relight()                # E arms (chipped ends)
    arm_mid = E.rect(12, 27, 33, 38).relight()
    arm_bot = E.rect(12, 52, 38, 63).relight()
    bowl = D.keep(lambda x, y: x >= 16 and 3 <= y <= 60).relight()        # D bowl  ⊃
    r_bowl = Rr.keep(lambda x, y: x >= 15 and y <= 31).relight()           # R bowl
    r_leg = Rr.keep(lambda x, y: x >= 15 and y >= 32).relight()            # R leg   \
    # V right stroke "/" is complete (it's drawn over the left one). Where the
    # strokes are apart, its left edge is the start of the 2nd run; fit a line
    # through those and extend it down through the overlap.
    vpx = V.px
    pts = []
    for y in range(V.h()):
        row = sorted(x for (x, yy) in vpx if yy == y)
        gaps = [row[i + 1] for i in range(len(row) - 1) if row[i + 1] - row[i] > 1]
        if gaps:
            pts.append((y, gaps[-1]))
    n = len(pts)
    my = sum(y for y, _ in pts) / n
    mx = sum(x for _, x in pts) / n
    k = sum((y - my) * (x - mx) for y, x in pts) / sum((y - my) ** 2 for y, _ in pts)
    edge = lambda y: mx + k * (y - my)
    v_right = V.keep(lambda x, y: y >= 4 and x >= round(edge(y))).relight()

    def stem(h, which=stem_e):
        return which.stretch_v(h, at=which.h() // 2 + 6).relight() if which.h() < h else which.rect(0, 0, which.w() - 1, h - 1).relight()

    A = {}
    for ch in "STARDEWVLY":
        A[ch] = R[ch].relight()
    # I: a lone stem
    A["I"] = stem(HGT, stem_t)
    # H: two stems + a long arm across the middle
    bar = arm_mid.stretch_h(30).relight()
    A["H"] = compose((bar, 6, 26), (stem_e, 0, 0), (stem_d, 30, 0))
    # F: E without its bottom arm
    A["F"] = E.keep(lambda x, y: not (y >= 52 and x >= 13)).relight()
    # P / B from R
    P = Rr.keep(lambda x, y: not (y >= 32 and x >= 15)).relight()
    A["P"] = P
    A["B"] = compose((P, 0, 0), (r_bowl.stretch_v(33).relight(), 13, 30), (stem_r, 3, 0))
    # K: stem + R leg below + flipped R leg above
    leg_up = r_leg.flip_v().relight()
    A["K"] = compose((leg_up, 9, 0), (r_leg, 9, 31), (stem_l, 0, 0))
    # O: mirrored D bowl + D bowl
    left = bowl.flip_h().relight()
    O = compose((left, 0, 3), (bowl, left.w() - 3, 3))
    A["O"] = O
    A["Q"] = compose((O, 0, 0), (r_leg.rect(10, 14, 30, 31).relight(), O.w() - 18, O.bbox[3] - 14))
    # C / G: left bowl + short arms
    C = compose((left, 0, 3), (arm_top.rect(8, 0, 26, 11).relight(), left.w() - 6, 3),
                (arm_bot.rect(8, 0, 26, 11).relight(), left.w() - 6, 3 + left.h() - 12))
    A["C"] = C
    g_stem = stem_t.rect(0, 30, 12, 59).relight()
    cw = C.norm().w()
    A["G"] = compose((C, 0, 0), (g_stem, cw - 13, 3 + left.h() - g_stem.h()),
                     (arm_mid.rect(0, 0, 16, 11).relight(), cw - 22, 30))
    # U / J: stems + rotated bowl as the cup
    cup = bowl.rot_cw().relight()                    # ∪
    sh = HGT - cup.h() + 12
    A["U"] = compose((cup, 0, HGT - cup.h()), (stem(sh, stem_l), 0, 0), (stem(sh, stem_d), cup.w() - 13, 0))
    half = cup.keep(lambda x, y: x <= cup.w() // 2 + 2).relight()
    A["J"] = compose((half, 0, HGT - half.h()), (stem(sh + 4, stem_t), half.w() - 9, 0))
    # N / M / X / Z from V strokes
    diag = v_right.flip_h().relight()                # "\" (complete)
    dg = diag.stretch_v(HGT - 2).relight()
    A["N"] = compose((dg, 7, 1), (stem_e, 0, 0), (stem_d, dg.w() + 3, 0))
    Vfull = R["V"].relight()
    A["M"] = compose((Vfull, 7, 1), (stem_e, 0, 0), (stem_d, Vfull.w() - 6, 0))
    A["X"] = compose((dg, 0, 1), (v_right.stretch_v(HGT - 2).relight(), 2, 1))
    zd = v_right.stretch_v(HGT - 20).relight()
    A["Z"] = compose((zd, 4, 10), (arm_top.stretch_h(zd.w() + 6).relight(), 0, 0),
                     (arm_bot.stretch_h(zd.w() + 6).relight(), 1, HGT - 12))
    # baseline-align everything to the bottom of a 64px cell
    out = {}
    for ch, g in A.items():
        g = g.norm()
        out[ch] = g.shift(0, HGT - g.h()) if g.h() < HGT else g
    return out


def render(g, pal=GOLD):
    g = g.norm()
    im = Image.new("RGBA", (g.w(), max(g.h(), 1)), (0, 0, 0, 0))
    for (x, y), c in g.px.items():
        im.putpixel((x, y), pal[c] + (255,))
    return im


def extract_leaves(logo):
    """Green leaf sprites from the logo + where they sit (letter-relative)."""
    px = logo.load()
    greens = {(53, 178, 26), (35, 114, 58), (16, 73, 51), (124, 248, 57)}
    W, H = logo.size
    seen, out = set(), []
    for y in range(H):
        for x in range(W):
            if (x, y) in seen or px[x, y][:3] not in greens:
                continue
            st, pts = [(x, y)], []
            seen.add((x, y))
            while st:
                a, b = st.pop()
                pts.append((a, b))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        n = (a + dx, b + dy)
                        if 0 <= n[0] < W and 0 <= n[1] < H and n not in seen and px[n][:3] in greens:
                            seen.add(n)
                            st.append(n)
            if len(pts) > 25:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                x0, y0 = min(xs), min(ys)
                im = Image.new("RGBA", (max(xs) - x0 + 1, max(ys) - y0 + 1), (0, 0, 0, 0))
                for p in pts:
                    im.putpixel((p[0] - x0, p[1] - y0), px[p])
                out.append((x0, y0, im))
    return out


def build_logo_kit(SRC, OUT, save):
    logo = Image.open(os.path.join(SRC, "LooseSprites", "logo..png")).convert("RGBA")
    letters = extract_letters(logo)
    alpha = build_alphabet(letters)
    leaves = extract_leaves(logo)
    # pack: glyphs on one row (64 tall), leaves on a second row
    imgs = {ch: render(g) for ch, g in sorted(alpha.items())}
    pad = 2
    W = sum(im.width + pad for im in imgs.values()) + pad
    lw = sum(l[2].width + pad for l in leaves) + pad
    lh = max(l[2].height for l in leaves)
    sheet = Image.new("RGBA", (max(W, lw), 64 + pad * 3 + lh), (0, 0, 0, 0))
    meta = {"height": 64, "glyphs": {}, "leaves": []}
    x = pad
    for ch, im in imgs.items():
        sheet.paste(im, (x, pad + 64 - im.height))
        meta["glyphs"][ch] = [x, pad, im.width, 64]
        x += im.width + pad
    # leaf anchors, from where they sit on the real logo (letter boxes there:
    # line 1 y 33..97, S starts x 30, W ends x 374; line 2 y 120..185, V
    # starts x 63, Y ends x 330)
    x = pad
    for (lx, ly, im) in sorted(leaves, key=lambda l: (l[1] > 110, l[0])):
        sheet.paste(im, (x, 64 + pad * 2))
        line2 = ly > 105
        top = 120 if line2 else 33
        start, end = (63, 330) if line2 else (30, 374)
        # anchor to the nearer end of the line
        if lx + im.width / 2 < (start + end) / 2:
            anchor, ax = "start", lx - start
        else:
            anchor, ax = "end", lx - end
        meta["leaves"].append({"rect": [x, 64 + pad * 2, im.width, im.height],
                               "line": 1 if line2 else 0, "anchor": anchor,
                               "dx": ax, "dy": ly - top})
        x += im.width + pad
    save(sheet, "logo_kit.png")
    with open(os.path.join(OUT, "logo_kit.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    print("logo_kit.json", len(meta["glyphs"]), "glyphs", len(meta["leaves"]), "leaves")
    return alpha


# ------------------------------------------------------------ backdrop ---
def build_title_bg(SRC, OUT, save):
    p = lambda *a: os.path.join(SRC, *a)
    cur = Image.open(p("LooseSprites", "Cursors..png")).convert("RGBA")
    clouds = Image.open(p("Minigames", "Clouds..png")).convert("RGBA")
    W, H = 640, 360            # 1/3 of a 1920x1080 screen (TitleMenu draws at 3x)
    bg = Image.new("RGBA", (W, H), (64, 136, 248, 255))
    # sky gradient strip (703,1912,1,264) stretched; bottom of it meets the hills
    sky = cur.crop((703, 1912, 704, 2176)).resize((W, H - 120 + 40), Image.NEAREST)
    bg.alpha_composite(sky, (0, -40))
    # a few twinkles like the key art
    for sx, sy in [(30, 18), (402, 8), (590, 30), (250, 40), (520, 70), (110, 60)]:
        for dx, dy in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]:
            bg.putpixel((sx + dx, sy + dy), (255, 255, 255, 255 if (dx, dy) == (0, 0) else 150))
    # clouds (big one at y = H - 750/3, small ones at H - 300 - j*12)
    big = clouds.crop((0, 0, 512, 337))
    big.putalpha(big.getchannel("A").point(lambda a: int(a * 0.55)))
    bg.alpha_composite(big, (-150, H - 250))
    smalls = [(152, 447, 123, 55), (0, 471, 149, 66), (410, 467, 63, 37)]
    for j, (sx, y) in enumerate([(420, 60), (40, 92), (300, 120), (560, 104)]):
        r = smalls[j % 3]
        c = clouds.crop((r[0], r[1], r[0] + r[2], r[1] + r[3]))
        c.putalpha(c.getchannel("A").point(lambda a: int(a * 0.8)))
        bg.alpha_composite(c, (sx, y))
    # mountains: back range (0,886) at H-474/3, front range (0,737) at H-444/3
    back = cur.crop((0, 886, 639, 1034))
    front = cur.crop((0, 737, 639, 885))
    bg.alpha_composite(back, (-30, H - 158))
    bg.alpha_composite(back, (609, H - 158))
    bg.alpha_composite(front, (0, H - 148))
    bg.alpha_composite(front, (639, H - 148))

    # ---- farm row (real sprites) ----
    A = os.path.join(OUT)  # composed assets from this build (trees, coop...)
    ld = lambda name: Image.open(os.path.join(A, name)).convert("RGBA")
    fence = Image.open(p("LooseSprites", "Fence1..png")).convert("RGBA")
    bushes = Image.open(p("TileSheets", "bushes..png")).convert("RGBA")
    crops = Image.open(p("TileSheets", "crops..png")).convert("RGBA")
    outdoors = Image.open(p("Maps", "spring_outdoorsTileSheet..png")).convert("RGBA")
    ground_y = H - 52          # top of the grass band
    path_y = H - 22            # dirt path along the bottom
    # grass band + dirt path from real tiles
    grass = outdoors.crop((0, 7 * 16, 16, 8 * 16))
    for x in range(0, W, 16):
        for y in range(ground_y, H, 16):
            bg.alpha_composite(grass, (x, y))
    tiles = ld("tileset.png")
    names = open(os.path.join(OUT, "tiles.gen.ts")).read()
    idx = {}
    for line in names.splitlines():
        line = line.strip()
        if ":" in line and line.endswith(","):
            k, v = line.rstrip(",").split(":")
            idx[k.strip()] = int(v)
    tl = lambda n: tiles.crop(((idx[n] % 8) * 16, (idx[n] // 8) * 16, (idx[n] % 8) * 16 + 16, (idx[n] // 8) * 16 + 16))
    dirt_n = "D_N" if "D_N" in idx else None
    for x in range(0, W, 16):
        bg.alpha_composite(tl("D_I0"), (x, path_y + 6))
        if dirt_n:
            bg.alpha_composite(tl(dirt_n), (x, path_y - 10))
    # the title menu's dark corner bushes (Clouds sheet), framing both sides
    bg.alpha_composite(clouds.crop((0, 554, 165, 696)), (-70, H - 142 - 30))
    bg.alpha_composite(clouds.crop((390, 543, 512, 696)), (W - 122 + 52, H - 153 - 30))
    # back layer: trees and bushes behind the fence
    def put(im, x, ybase):
        bg.alpha_composite(im, (int(x), int(ybase - im.height)))
    put(ld("tree_oak.png"), 128, ground_y + 26)
    put(ld("tree_pine.png"), 456, ground_y + 22)
    put(bushes.crop((0, 0, 32, 48)), 200, ground_y + 14)
    put(bushes.crop((0, 128, 48, 176)), 560, ground_y + 16)
    # fence along the back of the yard (Fence1: 600-guide horizontal piece)
    fy = ground_y + 12
    for i, x in enumerate(range(-8, W, 16)):
        piece = 2 if 0 < i else 0
        put(fence.crop(((piece % 3) * 16, (piece // 3) * 32, (piece % 3) * 16 + 16, (piece // 3) * 32 + 32)), x, fy)
    # front layer
    put(bushes.crop((32, 0, 64, 48)), 40, ground_y + 30)          # berry bush
    put(bushes.crop((0, 0, 32, 48)), 100, ground_y + 36)
    put(ld("b_coop.png"), 340, path_y + 4)
    put(bushes.crop((0, 224, 16, 256)), 438, ground_y + 30)
    put(bushes.crop((32, 0, 64, 48)), 520, ground_y + 32)
    put(bushes.crop((16, 224, 32, 256)), 610, ground_y + 30)
    # sunflowers by the coop
    sun = crops.crop((80, 480, 96, 512))
    for k in range(4):
        put(sun, 470 + k * 15, path_y + 6 - (k % 2) * 2)
    # chickens (Animals/*Chicken: 16x16 frames, frame 0 = facing down)
    wc = Image.open(p("Animals", "White Chicken..png")).convert("RGBA")
    bc = Image.open(p("Animals", "Brown Chicken..png")).convert("RGBA")
    chick = Image.open(p("Animals", "BabyWhite Chicken..png")).convert("RGBA")
    put(wc.crop((0, 16 * 1, 16, 32)), 250, ground_y + 40)      # facing right
    put(bc.crop((0, 16 * 3, 16, 64)), 290, ground_y + 44)      # facing left
    put(chick.crop((0, 0, 16, 16)), 64, path_y + 2)
    put(chick.crop((0, 16, 16, 32)), 84, path_y + 4)
    # a villager walking the path
    sam = Image.open(p("Characters", "Haley..png")).convert("RGBA") if os.path.isfile(p("Characters", "Haley..png")) else None
    if sam:
        put(sam.crop((0, 32, 16, 64)), 190, path_y + 14)     # facing right
    save(bg.convert("RGB"), "title_bg.png")


def build(SRC, OUT, save):
    build_logo_kit(SRC, OUT, save)
    build_title_bg(SRC, OUT, save)


if __name__ == "__main__":
    def _save(img, name):
        img.save(os.path.join(sys.argv[2], name))
        print(name, img.size)
    build(sys.argv[1], sys.argv[2], _save)
