#!/usr/bin/env python3
"""Generate Stardew-style pixel assets for the world app."""
import os, sys, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets")
os.makedirs(OUT, exist_ok=True)
random.seed(7)

T = 16  # tile px

def save(img, name):
    img.save(os.path.join(OUT, name))
    print("wrote", name, img.size)

# ---------- helpers ----------
def px(d, x, y, c):
    d.point((x, y), fill=c)

def rect(d, x0, y0, x1, y1, c):
    d.rectangle([x0, y0, x1, y1], fill=c)

# ---------- tileset ----------
def gen_tileset():
    COLS, ROWS = 8, 5
    img = Image.new("RGBA", (COLS * T, ROWS * T), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    grass_a = (88, 171, 60)
    grass_b = (79, 156, 55)
    grass_dark = (62, 124, 44)
    dirt = (189, 132, 76)
    dirt_dark = (160, 108, 60)
    water = (62, 137, 214)
    water_dark = (47, 112, 185)
    stone = (168, 160, 148)
    stone_dark = (138, 130, 118)

    def base(x, y, c):
        rect(d, x * T, y * T, x * T + T - 1, y * T + T - 1, c)

    def speckle(x, y, c, n):
        for _ in range(n):
            px(d, x * T + random.randrange(T), y * T + random.randrange(T), c)

    # 0 grass base
    base(0, 0, grass_a); speckle(0, 0, grass_b, 14)
    # 1 grass tufts
    base(1, 0, grass_a); speckle(1, 0, grass_b, 10)
    for gx in (3, 9, 13):
        px(d, 1 * T + gx, 11, grass_dark); px(d, 1 * T + gx - 1, 12, grass_dark); px(d, 1 * T + gx + 1, 12, grass_dark)
    # 2 grass + white flowers
    base(2, 0, grass_a); speckle(2, 0, grass_b, 10)
    for fx, fy in ((4, 5), (11, 9)):
        for ox, oy in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)):
            px(d, 2 * T + fx + ox, fy + oy, (245, 245, 235))
        px(d, 2 * T + fx, fy, (240, 200, 60))
    # 3 grass + yellow flowers
    base(3, 0, grass_a); speckle(3, 0, grass_b, 10)
    for fx, fy in ((5, 10), (12, 4)):
        for ox, oy in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)):
            px(d, 3 * T + fx + ox, fy + oy, (250, 214, 80))
        px(d, 3 * T + fx, fy, (200, 140, 40))
    # 4 dirt path
    base(4, 0, dirt); speckle(4, 0, dirt_dark, 16)
    # 5 water
    base(5, 0, water)
    for wy in (3, 8, 13):
        for wx in (0, 6, 11):
            px(d, 5 * T + wx, wy, water_dark); px(d, 5 * T + wx + 1, wy, water_dark); px(d, 5 * T + wx + 2, wy, water_dark)
    # 6 water light (edge/shore overlay)
    base(6, 0, water); speckle(6, 0, (110, 175, 235), 8)
    # 7 tilled soil
    base(7, 0, (140, 96, 55))
    for ry in range(2, 15, 4):
        rect(d, 7 * T, ry, 7 * T + T - 1, ry + 1, (115, 78, 44))
    # row 1: 8 paved stone, 9 wood plank, 10 cobble
    base(0, 1, stone)
    for sx, sy in ((0, 0), (8, 0), (0, 8), (8, 8), (4, 4), (12, 4), (4, 12), (12, 12)):
        rect(d, sx, sy + T, sx + 7, sy + T + 7, stone)  # noop keep base
    speckle(0, 1, stone_dark, 12)
    # 9 wood plank
    base(1, 1, (176, 128, 78))
    for wy in (3, 7, 11, 15):
        rect(d, 1 * T, wy, 1 * T + T - 1, wy, (150, 106, 62))
    # 10 cobble dark
    base(2, 1, (120, 115, 108)); speckle(2, 1, (96, 92, 86), 18); speckle(2, 1, (145, 140, 132), 8)
    # 11 dark grass (night/forest variant)
    base(3, 1, (52, 110, 46)); speckle(3, 1, (40, 92, 38), 14)
    # 12 sand
    base(4, 1, (230, 205, 140)); speckle(4, 1, (210, 182, 118), 14)
    # 13-15 spare
    save(img, "tileset.png")
    return COLS

# ---------- props: trees, bush, rock, fence, crops, sign ----------
def gen_props():
    # oak tree 48x64
    img = Image.new("RGBA", (48, 64), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    trunk = (110, 70, 40); trunk_d = (88, 55, 30)
    leaf = (56, 140, 50); leaf_d = (40, 112, 40); leaf_l = (78, 168, 62)
    rect(d, 20, 40, 27, 62, trunk); rect(d, 20, 40, 22, 62, trunk_d)
    # canopy blobs
    for cx, cy, r in ((24, 18, 15), (13, 26, 11), (35, 26, 11), (24, 30, 13), (18, 12, 9), (30, 12, 9)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=leaf_d)
    for cx, cy, r in ((24, 15, 14), (14, 23, 10), (34, 23, 10), (24, 27, 12)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=leaf)
    for cx, cy, r in ((20, 12, 6), (30, 10, 5), (15, 20, 5)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=leaf_l)
    save(img, "tree_oak.png")

    # pine 48x64
    img = Image.new("RGBA", (48, 64), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    pine = (40, 105, 60); pine_d = (30, 84, 48); pine_l = (56, 128, 74)
    rect(d, 21, 52, 26, 62, (96, 62, 36))
    tiers = [(24, 4, 7), (24, 13, 10), (24, 23, 13), (24, 34, 16), (24, 45, 18)]
    for i, (cx, cy, w) in enumerate(tiers):
        col = pine_d if i % 2 else pine
        d.polygon([(cx - w, cy + 14), (cx + w, cy + 14), (cx, cy)], fill=col)
    d.polygon([(24 - 7, 18), (24 + 7, 18), (24, 4)], fill=pine_l)
    save(img, "tree_pine.png")

    # bush 24x20
    img = Image.new("RGBA", (24, 20), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for cx, cy, r in ((7, 11, 6), (16, 11, 6), (12, 7, 6)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(52, 124, 46))
    for cx, cy, r in ((6, 9, 4), (15, 9, 4), (11, 5, 4)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(70, 150, 56))
    save(img, "bush.png")

    # rock 20x14
    img = Image.new("RGBA", (20, 14), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.ellipse([1, 2, 18, 13], fill=(128, 122, 116)); d.ellipse([3, 3, 15, 10], fill=(150, 144, 136))
    save(img, "rock.png")

    # fence 16x16 (post + rails)
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    wood = (146, 96, 52); wood_d = (118, 76, 40)
    rect(d, 0, 4, 15, 6, wood); rect(d, 0, 10, 15, 12, wood)
    rect(d, 6, 1, 9, 15, wood); rect(d, 6, 1, 7, 15, wood_d)
    save(img, "fence.png")

    # crop patch 16x16 (sprouts)
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for cx in (4, 12):
        for ox, oy in ((0, 0), (-2, 1), (2, 1)):
            px(d, cx + ox, 8 + oy, (70, 160, 60)); px(d, cx + ox, 9 + oy, (70, 160, 60))
    save(img, "crops.png")

    # sign 20x24
    img = Image.new("RGBA", (20, 24), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    rect(d, 9, 10, 10, 22, (110, 70, 40))
    rect(d, 1, 1, 18, 11, (176, 128, 78)); rect(d, 1, 1, 18, 3, (196, 148, 96))
    save(img, "sign.png")

    # mailbox 16x20
    img = Image.new("RGBA", (16, 20), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    rect(d, 7, 9, 8, 18, (120, 78, 44))
    rect(d, 3, 2, 12, 9, (210, 210, 205)); rect(d, 3, 2, 12, 4, (240, 240, 235))
    rect(d, 12, 3, 13, 6, (200, 60, 50))
    save(img, "mailbox.png")

# ---------- buildings ----------
def building(w, h, wall, roof, door, windows, name, roofstyle="gable"):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    wall_d = tuple(max(0, c - 28) for c in wall)
    roof_d = tuple(max(0, c - 34) for c in roof)
    roof_l = tuple(min(255, c + 30) for c in roof)
    base_y = h - 4
    wall_top = h // 2 - 6
    # walls
    rect(d, 4, wall_top, w - 5, base_y, wall)
    # wall plank lines
    for lx in range(8, w - 6, 8):
        rect(d, lx, wall_top, lx, base_y, wall_d)
    rect(d, 4, base_y - 3, w - 5, base_y, wall_d)
    # roof
    if roofstyle == "gable":
        d.polygon([(0, wall_top + 2), (w // 2, 2), (w, wall_top + 2)], fill=roof)
        d.polygon([(0, wall_top + 2), (w // 2, 2), (w // 2 - 10, wall_top + 2)], fill=roof_d)
        for ry in range(6, wall_top, 7):
            d.line([(w // 2 - (w // 2 - 2) * (ry - 2) / (wall_top - 2), ry),
                    (w // 2 + (w // 2 - 2) * (ry - 2) / (wall_top - 2), ry)], fill=roof_d, width=1)
    elif roofstyle == "flat":
        rect(d, 0, 4, w - 1, wall_top + 2, roof); rect(d, 0, 4, w - 1, 9, roof_l)
    else:  # shed
        d.polygon([(0, wall_top - 8), (w, wall_top + 2), (0, wall_top + 2)], fill=roof)
        d.polygon([(0, wall_top - 8), (w // 2, wall_top - 3), (0, wall_top + 2)], fill=roof_d)
    # door
    dx0, dw = w // 2 - 9, 18
    rect(d, dx0, base_y - 22, dx0 + dw, base_y, door)
    rect(d, dx0, base_y - 22, dx0 + dw, base_y - 20, tuple(min(255, c + 24) for c in door))
    rect(d, dx0 + dw - 4, base_y - 12, dx0 + dw - 2, base_y - 10, (240, 220, 160))
    # windows
    for wx, wy in windows:
        rect(d, wx, wy, wx + 12, wy + 10, (150, 200, 230))
        rect(d, wx, wy, wx + 12, wy + 1, (110, 90, 60)); rect(d, wx, wy + 9, wx + 12, wy + 10, (110, 90, 60))
        rect(d, wx + 5, wy, wx + 6, wy + 10, (110, 90, 60))
    save(img, name)

def gen_buildings():
    # town hall — wide, cream walls, red roof
    building(112, 96, (222, 200, 160), (160, 52, 40), (120, 80, 46),
             [(14, 40), (84, 40)], "b_townhall.png", "gable")
    # barn — red walls, dark roof
    building(96, 88, (170, 60, 44), (90, 60, 40), (70, 46, 30),
             [(14, 44), (70, 44)], "b_barn.png", "gable")
    # cottage — warm wood, orange roof
    building(88, 84, (206, 176, 130), (196, 110, 40), (96, 62, 36),
             [(10, 42), (64, 42)], "b_cottage.png", "gable")
    # greenhouse — pale walls w/ glass hint, teal roof
    building(96, 80, (200, 214, 200), (60, 140, 130), (90, 110, 90),
             [(12, 38), (72, 38)], "b_green.png", "flat")
    # shop — stone-ish walls, blue roof
    building(92, 88, (190, 182, 168), (70, 100, 180), (110, 80, 50),
             [(12, 44), (66, 44)], "b_shop.png", "gable")
    # dojo — dark wood, black roof
    building(88, 84, (120, 100, 84), (40, 40, 50), (60, 44, 34),
             [(12, 44), (62, 44)], "b_dojo.png", "shed")

# ---------- characters ----------
SKINS = [(242, 200, 165), (222, 172, 130), (176, 118, 82), (120, 76, 52)]
HAIRS = [(60, 40, 25), (120, 70, 30), (200, 150, 60), (40, 40, 45), (150, 60, 40), (90, 90, 100)]
SHIRTS = [(60, 120, 200), (200, 70, 60), (80, 170, 90), (230, 180, 60), (150, 90, 190), (240, 240, 235)]
PANTS = [(50, 60, 110), (60, 60, 60), (110, 80, 50), (40, 90, 60)]

def draw_char(d, ox, skin, hair, shirt, pants, facing, frame):
    """16x32 char at (ox,0). frame 0/2 stand, 1/3 step."""
    dark = tuple(max(0, c - 34) for c in shirt)
    hair_d = tuple(max(0, c - 30) for c in hair)
    # legs
    step = 1 if frame in (1, 3) else 0
    if frame == 1:
        rect(d, ox + 5, 26, ox + 7, 31, pants); rect(d, ox + 8, 27, ox + 10, 31, pants)
    elif frame == 3:
        rect(d, ox + 5, 27, ox + 7, 31, pants); rect(d, ox + 8, 26, ox + 10, 31, pants)
    else:
        rect(d, ox + 5, 26, ox + 7, 31, pants); rect(d, ox + 8, 26, ox + 10, 31, pants)
    # shoes
    rect(d, ox + 5, 30, ox + 7, 31, (70, 45, 30)); rect(d, ox + 8, 30, ox + 10, 31, (70, 45, 30))
    # body
    rect(d, ox + 4, 14, ox + 11, 26, shirt)
    rect(d, ox + 4, 14, ox + 5, 26, dark)  # shading
    # arms
    arm_swing = step
    if facing == "left":
        rect(d, ox + 3, 15, ox + 4, 23, shirt); rect(d, ox + 3, 22, ox + 4, 24, skin)
    elif facing == "right":
        rect(d, ox + 11, 15, ox + 12, 23, shirt); rect(d, ox + 11, 22, ox + 12, 24, skin)
    else:
        rect(d, ox + 2, 15 + arm_swing, ox + 3, 23 + arm_swing, shirt); rect(d, ox + 2, 22 + arm_swing, ox + 3, 24 + arm_swing, skin)
        rect(d, ox + 12, 15 + (1 - arm_swing), ox + 13, 23 + (1 - arm_swing), shirt); rect(d, ox + 12, 22 + (1 - arm_swing), ox + 13, 24 + (1 - arm_swing), skin)
    # head
    rect(d, ox + 4, 3, ox + 11, 13, skin)
    if facing == "down":
        rect(d, ox + 4, 3, ox + 11, 6, hair); rect(d, ox + 4, 7, ox + 5, 10, hair); rect(d, ox + 10, 7, ox + 11, 10, hair)
        px(d, ox + 6, 9, (30, 30, 40)); px(d, ox + 9, 9, (30, 30, 40))
        rect(d, ox + 7, 11, ox + 8, 11, tuple(max(0, c - 40) for c in skin))
    elif facing == "up":
        rect(d, ox + 4, 3, ox + 11, 13, hair); rect(d, ox + 4, 6, ox + 11, 13, hair_d)
    elif facing == "left":
        rect(d, ox + 4, 3, ox + 11, 6, hair); rect(d, ox + 7, 6, ox + 11, 13, hair)
        px(d, ox + 6, 9, (30, 30, 40))
    else:
        rect(d, ox + 4, 3, ox + 11, 6, hair); rect(d, ox + 4, 6, ox + 8, 13, hair)
        px(d, ox + 9, 9, (30, 30, 40))

def gen_characters():
    # sheet: rows=variants, cols=16 frames (4 dirs x 4 frames), frame 16x32
    V = 6
    img = Image.new("RGBA", (16 * 16, 32 * V), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    combos = [
        (SKINS[0], HAIRS[0], SHIRTS[0], PANTS[0]),
        (SKINS[1], HAIRS[2], SHIRTS[1], PANTS[1]),
        (SKINS[2], HAIRS[3], SHIRTS[2], PANTS[0]),
        (SKINS[3], HAIRS[1], SHIRTS[3], PANTS[2]),
        (SKINS[0], HAIRS[4], SHIRTS[4], PANTS[1]),
        (SKINS[1], HAIRS[5], SHIRTS[5], PANTS[3]),
    ]
    dirs = ["down", "up", "left", "right"]
    for v, (skin, hair, shirt, pants) in enumerate(combos):
        for di, facing in enumerate(dirs):
            for fr in range(4):
                draw_char(d, (di * 4 + fr) * 16, skin, hair, shirt, pants, facing, fr)
    save(img, "characters.png")

def gen_npcs():
    # 4 NPC sprites in a row: suit CEO, HR rep, IT, ops manager — 16x32 each, facing down
    img = Image.new("RGBA", (16 * 4, 32), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    npcs = [
        (SKINS[1], (40, 40, 45), (60, 60, 80), (45, 45, 55)),   # suit
        (SKINS[0], (150, 60, 40), (200, 120, 140), (60, 60, 70)),  # hr
        (SKINS[2], (30, 30, 35), (80, 160, 140), (60, 70, 90)),   # it
        (SKINS[3], (20, 20, 25), (230, 150, 60), (70, 55, 40)),   # ops
    ]
    for i, (skin, hair, shirt, pants) in enumerate(npcs):
        draw_char(d, i * 16, skin, hair, shirt, pants, "down", 0)
    save(img, "npcs.png")

    # portraits 40x40 faces for dialog
    img = Image.new("RGBA", (40 * 4, 40), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for i, (skin, hair, shirt, _) in enumerate(npcs):
        ox = i * 40
        rect(d, ox + 6, 8, ox + 33, 38, skin)
        rect(d, ox + 6, 8, ox + 33, 16, hair); rect(d, ox + 6, 8, ox + 9, 26, hair); rect(d, ox + 30, 8, ox + 33, 26, hair)
        px(d, ox + 14, 22, (30, 30, 40)); px(d, ox + 15, 22, (30, 30, 40))
        px(d, ox + 24, 22, (30, 30, 40)); px(d, ox + 25, 22, (30, 30, 40))
        rect(d, ox + 17, 30, ox + 22, 31, tuple(max(0, c - 40) for c in skin))
    save(img, "portraits.png")

# ---------- logo ----------
def gen_logo(text):
    font_path = "/tmp/Stardew_Valley.ttf"
    if not os.path.exists(font_path):
        print("no font, skip logo"); return
    size = 110
    font = ImageFont.truetype(font_path, size)
    words = text.upper().split()
    lines = [words] if len(words) <= 2 else [words[: len(words) // 2 + len(words) % 2], words[len(words) // 2 + len(words) % 2:]]
    pad = 26
    tmp = Image.new("RGBA", (1600, 400), (0, 0, 0, 0)); d = ImageDraw.Draw(tmp)
    y = 20
    for line in lines:
        s = " ".join(line)
        bbox = d.textbbox((0, 0), s, font=font, stroke_width=0)
        d.text((800 - (bbox[2] - bbox[0]) / 2 - bbox[0], y), s, font=font, fill=(255, 255, 255), stroke_width=0)
        y += size + 10
    # wood gradient fill
    mask = tmp.split()[3]
    w, h = tmp.size
    grad = Image.new("RGB", (1, h))
    top_c, bot_c = (240, 190, 95), (170, 105, 45)
    for yy in range(h):
        t = yy / max(1, h - 1)
        grad.putpixel((0, yy), tuple(int(top_c[i] + (bot_c[i] - top_c[i]) * t) for i in range(3)))
    grad = grad.resize((w, h))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    # dark outline: dilate mask then composite dark, then re-paste gradient
    edge = mask.filter(ImageFilter.MaxFilter(9))
    outline = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dark_layer = Image.new("RGBA", (w, h), (80, 45, 18, 255))
    outline.paste(dark_layer, (0, 0), edge)
    outline.paste(grad, (0, 0), mask)
    # top highlight via a slightly offset brighter pass
    hi = mask.copy().point(lambda p: p)
    hi_layer = Image.new("RGBA", (w, h), (255, 235, 170, 0))
    # subtle speckle for wood grain
    od = ImageDraw.Draw(outline)
    rnd = random.Random(3)
    for _ in range(600):
        x = rnd.randrange(w); yy = rnd.randrange(h)
        if mask.getpixel((x, yy)) > 0 and rnd.random() < 0.5:
            od.point((x, yy), fill=(255, 220, 140, 90))
        elif mask.getpixel((x, yy)) > 0:
            od.point((x, yy), fill=(90, 50, 20, 90))
    # crop
    bbox = outline.getbbox()
    outline = outline.crop(bbox)
    # drop shadow baked in
    fin = Image.new("RGBA", (outline.width + 12, outline.height + 12), (0, 0, 0, 0))
    shadow = Image.new("RGBA", outline.size, (40, 22, 8, 200))
    shadow.putalpha(outline.split()[3].point(lambda p: int(p * 0.6)))
    fin.paste(shadow, (8, 8))
    fin.paste(outline, (0, 0))
    save(fin, "logo.png")

if __name__ == "__main__":
    company = sys.argv[1] if len(sys.argv) > 1 else "Orthogonal"
    gen_tileset(); gen_props(); gen_buildings(); gen_characters(); gen_npcs(); gen_logo(company)
    print("done")
