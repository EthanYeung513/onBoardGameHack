#!/usr/bin/env python3
"""Compose world/public/assets from the REAL Stardew Valley sprite dump.

Source: extracted copy of the game's Content images (a backup lives outside
the repo — do not commit the dump; this script only emits the composed files).
"""
import os
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sdv-assets/ext3/星露谷物语素材/Stardew valley"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets")
os.makedirs(OUT, exist_ok=True)


def p(*a):
    return os.path.join(SRC, *a)


def save(img, name):
    img.save(os.path.join(OUT, name))
    print(name, img.size)


T = 16
sheet = Image.open(p("Maps", "spring_outdoorsTileSheet..png")).convert("RGBA")


def tile(col, row):
    return sheet.crop((col * T, row * T, col * T + T, row * T + T))


# ---------- tileset: same 8x5 layout / indices as before ----------
img = Image.new("RGBA", (8 * T, 5 * T), (0, 0, 0, 0))
layout = {
    0: (0, 12),   # G  flat grass
    1: (2, 13),   # G_TUFT grass detail
    2: (0, 6),    # G_FLO_W flowers
    3: (1, 6),    # G_FLO_Y flowers
    4: (13, 23),  # DIRT interior
    5: (5, 49),   # WATER interior
    6: (3, 14),   # spare grass
    8: (22, 38),  # STONE path
    9: (12, 12),  # WOOD plank
    10: (1, 15),  # spare grass
    11: (0, 16),  # DGRASS (darkened below)
}
for idx, (c, r) in layout.items():
    img.paste(tile(c, r), ((idx % 8) * T, (idx // 8) * T))
# tilled soil from hoeDirt (8x4 grid of 16x16)
hoe = Image.open(p("TerrainFeatures", "hoeDirt..png")).convert("RGBA")
img.paste(hoe.crop((2 * T, 1 * T, 3 * T, 2 * T)), (7 * T, 0))
# darker grass for out-of-bounds edge
g = tile(0, 16).copy()
dk = Image.new("RGBA", (T, T), (0, 0, 0, 70))
g.alpha_composite(dk)
img.paste(g, (3 * T, 1 * T))
save(img, "tileset.png")

# ---------- props ----------
tree1 = Image.open(p("TerrainFeatures", "tree1_spring..png")).convert("RGBA")
save(tree1.crop((0, 0, 48, 80)), "tree_oak.png")
tree3 = Image.open(p("TerrainFeatures", "tree3_spring..png")).convert("RGBA")
save(tree3.crop((0, 0, 48, 80)), "tree_pine.png")

bushes = Image.open(p("TileSheets", "bushes..png")).convert("RGBA")
save(bushes.crop((0, 0, 32, 32)), "bush.png")

deb = Image.open(p("TileSheets", "debris..png")).convert("RGBA")
save(deb.crop((0, 0, 16, 16)), "rock.png")

fence = Image.open(p("LooseSprites", "Fence1..png")).convert("RGBA")
save(fence.crop((16, 16, 32, 32)), "fence.png")

crops = Image.open(p("TileSheets", "crops..png")).convert("RGBA")
save(crops.crop((10 * T, 4 * T, 11 * T, 6 * T)), "crops.png")

# sign + mailbox: small props harvested from the outdoor sheet (eyeball-tuned)
save(sheet.crop((11 * T, 18 * T, 12 * T, 20 * T)), "sign.png")
save(sheet.crop((6 * T, 75 * T, 7 * T, 77 * T)), "mailbox.png")

# ---------- buildings ----------
houses = Image.open(p("Buildings", "houses..png")).convert("RGBA")
save(houses.crop((0, 0, 136, 144)), "b_townhall.png")
for src_name, key in [("Barn", "b_barn"), ("Coop", "b_coop"), ("Stable", "b_stable"),
                      ("Silo", "b_silo"), ("Well", "b_well"), ("Mill", "b_mill")]:
    save(Image.open(p("Buildings", src_name + "..png")).convert("RGBA"), key + ".png")

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
print("done")
