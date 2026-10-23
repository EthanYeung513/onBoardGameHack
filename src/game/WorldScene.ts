import Phaser from "phaser";
import { gameBus, worldState } from "./events";
import { parseMap, step, type Dir, type Pos, type TileKind } from "./logic";
import { DOORS, OFFICE_MAP, SPAWN } from "./map";

export const TILE = 32;
const MOVE_MS = 140;

const COLORS: Record<TileKind, number> = {
  wall: 0x2f3b2f,
  floor: 0x9fd18b,
  path: 0xe8d9a8,
  grass: 0x3f8f3f,
  building: 0x8a6f5a,
  door: 0x3b2a20,
};
const ROOFS: Record<string, number> = {
  townhall: 0x4a6fa5,
  security: 0x2b2d42,
  support: 0xd1495b,
  engineering: 0x00798c,
  annex: 0x7a7a7a,
  desk: 0xedae49,
};

/** The walkable office. Draws the map and player; every text screen is React, reached through the event bus. */
export class WorldScene extends Phaser.Scene {
  private readonly grid = parseMap(OFFICE_MAP);
  private pos: Pos = { ...SPAWN };
  private player!: Phaser.GameObjects.Image;
  private moving = false;
  private paused = false;
  private locked = new Set<string>();
  private lockLabels: Phaser.GameObjects.Text[] = [];
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private unsubscribers: (() => void)[] = [];

  constructor() {
    super("world");
  }

  create() {
    this.drawMap();
    this.drawBuildings();
    this.makeHeroTexture();
    this.player = this.add.image(this.toPx(this.pos.x), this.toPx(this.pos.y), "hero").setDepth(10);

    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys("W,A,S,D") as typeof this.wasd;

    this.setLocked(worldState.locked);
    this.unsubscribers.push(
      gameBus.on("input:move", ({ dir }) => this.tryMove(dir)),
      gameBus.on("overlay:open", () => (this.paused = true)),
      gameBus.on("overlay:close", () => (this.paused = false)),
      gameBus.on("world:locked", ({ buildings }) => this.setLocked(buildings)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribers.forEach((off) => off()));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.unsubscribers.forEach((off) => off()));
  }

  update() {
    if (this.paused || this.moving) return;
    const k = this.cursors;
    const w = this.wasd;
    if (k?.left.isDown || w?.A.isDown) this.tryMove("left");
    else if (k?.right.isDown || w?.D.isDown) this.tryMove("right");
    else if (k?.up.isDown || w?.W.isDown) this.tryMove("up");
    else if (k?.down.isDown || w?.S.isDown) this.tryMove("down");
  }

  private toPx(cell: number) {
    return cell * TILE + TILE / 2;
  }

  private tryMove(dir: Dir) {
    if (this.paused || this.moving) return;
    this.player.setFlipX(dir === "left");
    const result = step(this.grid, this.pos, dir, { locked: this.locked });
    if (result.moved) {
      this.moving = true;
      this.pos = result.pos;
      this.tweens.add({
        targets: this.player,
        x: this.toPx(result.pos.x),
        y: this.toPx(result.pos.y),
        duration: MOVE_MS,
        onComplete: () => {
          this.moving = false;
          if (result.event) this.emit(result.event);
        },
      });
    } else if (result.event) {
      // Brief cooldown so a held key doesn't re-trigger the door before the overlay opens.
      this.moving = true;
      this.time.delayedCall(300, () => (this.moving = false));
      this.emit(result.event);
    }
  }

  private emit(event: NonNullable<ReturnType<typeof step>["event"]>) {
    if (event.type === "encounter:phish") gameBus.emit("encounter:phish", {});
    else gameBus.emit(event.type, { building: event.building });
  }

  private setLocked(buildings: string[]) {
    this.locked = new Set(buildings);
    this.lockLabels.forEach((l) => l.destroy());
    this.lockLabels = buildings
      .map((b) => this.grid.doorOf[b])
      .filter(Boolean)
      .map((p) => this.add.text(this.toPx(p.x), this.toPx(p.y), "🔒", { fontSize: "18px" }).setOrigin(0.5).setDepth(5));
  }

  private drawMap() {
    const g = this.add.graphics();
    this.grid.tiles.forEach((row, y) =>
      row.forEach((kind, x) => {
        g.fillStyle(COLORS[kind]).fillRect(x * TILE, y * TILE, TILE, TILE);
        if (kind === "grass") {
          g.fillStyle(0x2d6e2d);
          for (const [dx, dy] of [[6, 20], [14, 10], [22, 22], [26, 8]]) g.fillRect(x * TILE + dx, y * TILE + dy, 3, 8);
        }
      }),
    );
  }

  private drawBuildings() {
    const g = this.add.graphics();
    for (const [ch, { building, label }] of Object.entries(DOORS)) {
      const door = this.grid.doorOf[building];
      if (!door) continue;
      // Buildings are 5x3 blocks centred on their door column; the door is on the side facing the path.
      const doorOnBottom = this.grid.tiles[door.y + 1]?.[door.x] !== "building";
      const top = doorOnBottom ? door.y - 2 : door.y;
      g.fillStyle(ROOFS[building] ?? 0x555555).fillRect((door.x - 2) * TILE, top * TILE, 5 * TILE, TILE + 8);
      g.fillStyle(0xf7f4ea).fillRect(door.x * TILE + 8, door.y * TILE + 6, 16, 20);
      g.fillStyle(0x3b2a20).fillRect(door.x * TILE + 10, door.y * TILE + 8, 12, 18);
      const labelY = doorOnBottom ? top * TILE - 2 : (top + 3) * TILE + 2;
      this.add
        .text(door.x * TILE + TILE / 2, labelY, label, { fontFamily: "monospace", fontSize: "13px", color: "#ffffff", backgroundColor: "#1b1e2bcc", padding: { x: 4, y: 2 } })
        .setOrigin(0.5, doorOnBottom ? 1 : 0)
        .setDepth(6)
        .setName(`label-${ch}`);
    }
  }

  private makeHeroTexture() {
    if (this.textures.exists("hero")) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x1b1e2b).fillRect(6, 22, 5, 6).fillRect(13, 22, 5, 6);
    g.fillStyle(0xe0533d).fillRect(4, 10, 16, 13);
    g.fillStyle(0xf2c9a0).fillRect(6, 1, 12, 10);
    g.fillStyle(0x1b1e2b).fillRect(6, 0, 12, 3).fillRect(9, 5, 2, 2).fillRect(14, 5, 2, 2);
    g.generateTexture("hero", 24, 28);
    g.destroy();
  }
}

export const WORLD_WIDTH = OFFICE_MAP[0].length * TILE;
export const WORLD_HEIGHT = OFFICE_MAP.length * TILE;
