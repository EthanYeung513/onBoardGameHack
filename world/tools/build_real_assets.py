#!/usr/bin/env python3
"""Compose world/public/assets from the REAL Stardew Valley sprite dump.

    npm run assets [-- /path/to/Content]      (or SDV_CONTENT=/path ...)

Source: extracted copy of the game's Content images (a backup lives outside
the repo — do not commit the dump; this script only emits the composed files).
Everything is written to a staging dir first and only copied into
public/assets (+ src/tiles.gen.ts) once the whole build succeeded, so a missing
or partial dump can never clobber the committed assets.
"""
import os
import shutil
import sys
import tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = "/tmp/sdv-assets/ext3/星露谷物语素材/Stardew valley"
SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SDV_CONTENT", DEFAULT_SRC)
REQUIRED = [
    ("Maps", "spring_outdoorsTileSheet..png"), ("Maps", "spring_town..png"),
    ("TerrainFeatures", "hoeDirt..png"), ("Buildings", "houses..png"),
    ("Characters", "Lewis..png"), ("Portraits", "Lewis..png"),
    ("LooseSprites", "logo..png"), ("LooseSprites", "stardewPanorama..png"),
    ("Minigames", "TitleButtons..png"),
]
_missing = [os.path.join(*r) for r in REQUIRED if not os.path.isfile(os.path.join(SRC, *r))]
if _missing:
    sys.exit(
        "\n[assets] ERROR: Stardew Valley content dump not found or incomplete.\n"
        f"  looked in: {SRC}\n"
        f"  missing:   {', '.join(_missing[:4])}{' ...' if len(_missing) > 4 else ''}\n"
        "  Pass the extracted Content folder: npm run assets -- /path/to/Content\n"
        "  (or set SDV_CONTENT). Nothing in public/assets was touched.\n")

DEST = os.path.join(HERE, "..", "public", "assets")
OUT = tempfile.mkdtemp(prefix="sdv-assets-")
GEN_TS = os.path.join(OUT, "tiles.gen.ts")


def p(*a):
    return os.path.join(SRC, *a)


def save(img, name):
    img.save(os.path.join(OUT, name))
    print(name, img.size)


T = 16
sheet = Image.open(p("Maps", "spring_outdoorsTileSheet..png")).convert("RGBA")


def tile(col, row):
    return sheet.crop((col * T, row * T, col * T + T, row * T + T))


town = Image.open(p("Maps", "spring_town..png")).convert("RGBA")


def ttile(col, row):
    return town.crop((col * T, row * T, col * T + T, row * T + T))


# ---------- tileset ----------
# Every tile gets a NAME; indices are assigned in order (8 per row) and
# written to src/tiles.gen.ts so the TS side never hardcodes numbers.
from PIL import ImageOps

hoe = Image.open(p("TerrainFeatures", "hoeDirt..png")).convert("RGBA")


def over(base, top):
    """composite top over a copy of base (both 16x16)"""
    b = base.copy()
    b.alpha_composite(top)
    return b


GRASS = tile(0, 7)
WATER_T = tile(9, 13)
TILES = []  # (name, image)


def add(name, img):
    TILES.append((name, img))


# grass family (bright spring grass, matches the dirt-autotile fringe)
add("G", GRASS)
add("G_TUFT", tile(0, 6))
add("G_FLO_W", tile(1, 6))
add("G_FLO_Y", tile(2, 6))
add("G_ALT", tile(0, 11))
add("G_DARK", tile(5, 14))
dk = tile(5, 14).copy()
dk.alpha_composite(Image.new("RGBA", (T, T), (0, 0, 0, 70)))
add("DGRASS", dk)  # out-of-bounds
add("WOOD", tile(12, 12))
# organic dirt autotile (outdoor clearing blob) incl. inner corners
for name, (c, r) in {
    "D_N": (1, 8), "D_S": (1, 10), "D_W": (0, 9), "D_E": (3, 9),
    "D_NW": (0, 8), "D_NE": (3, 8), "D_SW": (0, 10), "D_SE": (3, 10),
    "D_INW": (2, 8), "D_INE": (2, 7), "D_ISE": (3, 7),
    "D_I0": (1, 9), "D_I1": (2, 9), "D_I2": (2, 10),
    "D_PRINT": (6, 8), "D_PRINT2": (7, 8), "D_PEBBLE": (6, 9),
}.items():
    add(name, tile(c, r))
add("D_ISW", ImageOps.mirror(tile(3, 7)))
# cobble (Pelican Town) — interior variants
for i, (c, r) in enumerate([(0, 23), (1, 23), (0, 24), (1, 24)]):
    add(f"COB{i}", ttile(c, r))
add("PLAZA", ttile(6, 29))
# water + sandy shoreline (shore pieces sit ON water cells, transparent
# parts show water — baked here so the renderer draws one tile)
add("WATER", WATER_T)
add("WATER_LILY", over(WATER_T, tile(10, 11)))
add("WATER_LILY2", over(WATER_T, tile(10, 12)))
for name, (c, r) in {
    "SH_NW": (8, 7), "SH_N": (9, 7), "SH_NE": (10, 7),
    "SH_W": (8, 8), "SH_E": (10, 8), "SH_W2": (8, 9), "SH_E2": (10, 9),
    "SH_SW": (8, 10), "SH_S": (9, 10), "SH_SE": (10, 10),
    "SH_INW": (11, 7), "SH_ISW": (8, 12), "SH_ISE": (9, 12),
}.items():
    add(name, over(WATER_T, tile(c, r)))
add("SH_INE", over(WATER_T, ImageOps.mirror(tile(11, 7))))
# cliffs (south-facing rock face, 4 rows: lip/face/face/base). Transparent
# bits are baked over grass (upper level for lip/sides, lower for base).
for name, (c, r) in {
    "CL_LIP0": (17, 18), "CL_LIP1": (18, 18),
    "CL_F0": (17, 19), "CL_F1": (18, 19),
    "CL_G0": (17, 20), "CL_G1": (18, 20),
    "CL_B0": (17, 21), "CL_B1": (18, 21),
    "CL_LEND0": (16, 18), "CL_LEND1": (16, 19), "CL_LEND2": (16, 20), "CL_LEND3": (16, 21),
    "CL_REND0": (19, 18), "CL_REND1": (19, 19), "CL_REND2": (19, 20), "CL_REND3": (19, 21),
    "CL_SIDE_L": (16, 13), "CL_SIDE_R": (19, 13),
    "CL_SIDE_LB": (16, 17), "CL_SIDE_RB": (19, 17),
    "STAIR0": (22, 12), "STAIR1": (22, 13), "STAIR2": (22, 15),
}.items():
    add(name, over(GRASS, tile(c, r)))
# tilled soil autotile: TILL_<mask> (N=1 E=2 S=4 W=8), HoeDirt.drawGuide
GUIDE = {0: 0, 8: 15, 2: 13, 1: 12, 4: 4, 9: 11, 3: 9, 5: 8, 6: 1, 12: 3,
         10: 14, 7: 5, 15: 6, 13: 7, 11: 10, 14: 2}
for m in range(16):
    pos = GUIDE[m]
    add(f"TILL_{m}", over(tile(1, 9), hoe.crop(((pos % 4) * T, (pos // 4) * T, (pos % 4) * T + T, (pos // 4) * T + T))))

COLS = 8
rows = (len(TILES) + COLS - 1) // COLS
img = Image.new("RGBA", (COLS * T, rows * T), (0, 0, 0, 0))
for i, (_, t) in enumerate(TILES):
    img.paste(t, ((i % COLS) * T, (i // COLS) * T))
save(img, "tileset.png")
with open(GEN_TS, "w") as f:
    f.write("// GENERATED by tools/build_real_assets.py — do not edit by hand.\n")
    f.write("// Frame index of each named tile in public/assets/tileset.png.\n")
    f.write("export const TILE = {\n")
    for i, (n, _) in enumerate(TILES):
        f.write(f"  {n}: {i},\n")
    f.write("} as const;\nexport type TileName = keyof typeof TILE;\n")
print("tiles.gen.ts", len(TILES))

# ---------- raw sprite sheets (props reference rects on these) ----------
for src, name in [
    (("Maps", "springobjects..png"), "objects.png"),
    (("TileSheets", "Craftables..png"), "craftables.png"),
    (("LooseSprites", "Fence1..png"), "fence.png"),
    (("TileSheets", "bushes..png"), "bushes.png"),
    (("TileSheets", "fruitTrees..png"), "fruittrees.png"),
    (("TileSheets", "crops..png"), "crops.png"),
    (("Maps", "spring_town..png"), "town.png"),
]:
    save(Image.open(p(*src)).convert("RGBA"), name)

# full trees: 48x96 canopy over the 16x32 stump, both bottom-aligned (Tree.draw)
for n, out in [("tree1_spring", "tree_oak.png"), ("tree2_spring", "tree_maple.png"), ("tree3_spring", "tree_pine.png")]:
    tr = Image.open(p("TerrainFeatures", n + "..png")).convert("RGBA")
    c = Image.new("RGBA", (48, 96), (0, 0, 0, 0))
    c.alpha_composite(tr.crop((32, 96, 48, 128)), (16, 64))
    c.alpha_composite(tr.crop((0, 0, 48, 96)), (0, 0))
    save(c, out)

# tall-grass clumps: 4 tufts per tile like Grass.draw, 3 variants
gr = Image.open(p("TerrainFeatures", "grass..png")).convert("RGBA")
import random as _r
_r.seed(7)
gimg = Image.new("RGBA", (3 * 24, 28), (0, 0, 0, 0))
for v in range(3):
    for i in range(4):
        w = _r.randrange(3)
        tuft = gr.crop((w * 15, 0, w * 15 + 15, 20))
        if _r.random() < 0.5:
            tuft = ImageOps.mirror(tuft)
        x = v * 24 + (i % 2) * 8 + _r.randrange(-1, 2)
        y = (i // 2) * 7 + _r.randrange(-1, 2) + 1
        gimg.alpha_composite(tuft, (max(v * 24, x), max(0, y)))
save(gimg, "tallgrass.png")

# ---------- small legacy props ----------
bushes = Image.open(p("TileSheets", "bushes..png")).convert("RGBA")
save(bushes.crop((0, 0, 32, 32)), "bush.png")

# rain streak frame for the weather overlay
rain = Image.open(p("TileSheets", "rain..png")).convert("RGBA")
_r = rain.crop((0, 0, 64, 64))  # frames are 64x64; the streak sits mid-frame
save(_r.crop(_r.getbbox()), "raindrop.png")

# sign + mailbox: small props harvested from the outdoor sheet (eyeball-tuned)
save(sheet.crop((11 * T, 18 * T, 12 * T, 20 * T)), "sign.png")
save(sheet.crop((6 * T, 75 * T, 7 * T, 77 * T)), "mailbox.png")

# ---------- buildings: REAL Pelican Town buildings from spring_town ----------
def main_component(img):
    """keep only the largest 8-connected opaque blob (drops neighbouring
    props/sprites that share the crop box), trimmed + padded to whole tiles,
    bottom-aligned and horizontally centred"""
    w, h = img.size
    px = img.load()
    seen = [[False] * w for _ in range(h)]
    best = []
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0][x0] or px[x0, y0][3] < 8:
                continue
            comp, stack = [], [(x0, y0)]
            seen[y0][x0] = True
            while stack:
                x, y = stack.pop()
                comp.append((x, y))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny][3] >= 8:
                            seen[ny][nx] = True
                            stack.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    keep = Image.new("L", img.size, 0)
    kp = keep.load()
    for x, y in best:
        kp[x, y] = 255
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), keep)
    bb = out.getbbox()
    out = out.crop(bb)
    tw, th = -(-out.size[0] // T) * T, -(-out.size[1] // T) * T
    fin = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    fin.alpha_composite(out, ((tw - out.size[0]) // 2, th - out.size[1]))
    return fin


# generous tile boxes (col0,row0,col1,row1) on the town tilesheet
TOWN_B = {
    "b_smithy":   (25, 0, 30, 9),    # blacksmith (stone)
    "b_shop":     (5.4, 11, 16, 20), # Pierre's General Store
    "b_saloon":   (15.5, 11, 22, 20),  # Stardrop Saloon
    "b_clinic":   (0, 11, 5.6, 20),   # Harvey's clinic
    "b_green":    (5.5, 20, 14.2, 28),  # green cottage w/ porch
    "b_house":    (9, 0, 17, 11),    # blue cottage
    "b_house2":   (0, 0, 9, 9),      # orange duplex
    "b_house3":   (17, 1, 26, 11),   # grey-blue house
    "b_house4":   (22, 11, 32, 21),  # big two-storey house
    "b_trailer":  (14, 20, 23, 24),  # Pam's trailer
}
# tile rects to blank before extracting (props overlapping the building)
ERASE = {"b_clinic": [(0, 11, 1, 13)]}
for key, (c0, r0, c1, r1) in TOWN_B.items():
    src = town.copy()
    for e0, f0, e1, f1 in ERASE.get(key, []):
        src.paste((0, 0, 0, 0), (e0 * T, f0 * T, e1 * T, f1 * T))
    box = tuple(int(v * T) for v in (c0, r0, c1, r1))
    save(main_component(src.crop(box)), key + ".png")

# farm buildings (real Buildings/ textures; crop = closed-door frame)
B = lambda n: Image.open(p("Buildings", n + "..png")).convert("RGBA")
save(B("Big Barn").crop((0, 0, 112, 112)), "b_barn.png")
save(B("Coop").crop((0, 0, 96, 112)), "b_coop.png")
save(B("Silo").crop((0, 0, 48, 128)), "b_silo.png")
save(B("Well").crop((0, 0, 48, 80)), "b_well.png")
save(B("Stable").crop((0, 0, 64, 96)), "b_stable.png")
save(B("Shed").crop((0, 0, 112, 128)), "b_shed.png")
houses = B("houses")
save(houses.crop((0, 0, 160, 144)), "b_farmhouse.png")
save(houses.crop((0, 288, 160, 432)), "b_farmhouse2.png")
save(houses.crop((160, 160, 272, 320)), "b_greenhouse.png")
# Pelican Town community center (restored) as the town hall landmark
cc = town.crop((12 * T, 40 * T, 25 * T, 50 * T))
save(cc, "b_community.png")
save(cc, "b_townhall.png")  # town hall = community center

# ---------- characters: villagers for player + NPCs ----------
PLAYERS = ["Sam", "Sebastian", "Abigail", "Emily", "Maru", "Alex"]
for i, n in enumerate(PLAYERS):
    save(Image.open(p("Characters", n + "..png")).convert("RGBA"), f"p{i}.png")
NPCS = ["Lewis", "Gus", "Harvey", "Pierre"]
for i, n in enumerate(NPCS):
    save(Image.open(p("Characters", n + "..png")).convert("RGBA"), f"n{i}.png")

# portraits: 4 faces (first expression cell, 64x64) in a strip
strip = Image.new("RGBA", (64 * len(NPCS), 64), (0, 0, 0, 0))
for i, n in enumerate(NPCS):
    face = Image.open(p("Portraits", n + "..png")).convert("RGBA").crop((0, 0, 64, 64))
    strip.paste(face, (i * 64, 0))
save(strip, "portraits.png")

# ---------- landmark props extracted from the map sheets ----------
for name, sheet_img, (c0, r0, c1, r1) in [
    ("tree_big", sheet, (6, 0, 11.5, 6)),        # broad leafy tree
    ("tree_blossom", sheet, (16, 0, 21, 6)),     # pink cherry blossom
    ("fountain", town, (16, 32, 21.5, 37)),
    ("bench", town, (2, 9, 5, 11)),
    ("lamp", town, (11, 28, 12, 32)),
]:
    box = tuple(int(v * T) for v in (c0, r0, c1, r1))
    src = sheet_img.crop(box)
    if name == "tree_blossom":  # a door sprite touches the trunk — blank it
        src.paste((0, 0, 0, 0), (int(3.9 * T), int(3.95 * T), 5 * T, 6 * T))
    save(main_component(src), name + ".png")

# ---------- title screen: logo kit + real-sprite backdrop ----------
sys.dont_write_bytecode = True
sys.dont_write_bytecode = True
import title_assets  # noqa: E402  (same dir)
title_assets.build(SRC, OUT, save)

# ---------- commit: staging -> repo ----------
shutil.move(GEN_TS, os.path.join(HERE, "..", "src", "tiles.gen.ts"))
os.makedirs(DEST, exist_ok=True)
for f in sorted(os.listdir(OUT)):
    shutil.copy2(os.path.join(OUT, f), os.path.join(DEST, f))
shutil.rmtree(OUT)
print(f"[assets] wrote {DEST}")
