import Phaser from 'phaser';
import { COURSES, NPCS, type Course, type Npc } from '../config';
import { bus, input } from './bridge';

const T = 16;
const MAP_W = 60;
const MAP_H = 40;
const SPEED = 85;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// tile indices in tileset.png (8 per row)
const G = 0, G_TUFT = 1, G_FLO_W = 2, G_FLO_Y = 3, DIRT = 4, WATER = 5, TILL = 7;
const STONE = 8, WOOD = 9, DGRASS = 11;

interface BuildingSpec {
  course?: Course;
  key: string;
  x: number; y: number; // tile pos (top-left)
  w: number; h: number; // tile footprint
  doorX: number; doorY: number; // tile in front of door
  townHall?: boolean;
}

export class TownScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private keyE!: Phaser.Input.Keyboard.Key;
  private blocked = new Set<string>();
  private buildings: BuildingSpec[] = [];
  private npcs: { spec: Npc; sprite: Phaser.GameObjects.Sprite; dir: Phaser.Math.Vector2; timer: number; home: { x: number; y: number } }[] = [];
  private doorZones: { x: number; y: number; course: Course }[] = [];
  private facing: 'down' | 'up' | 'left' | 'right' = 'down';
  private interactCooldown = 0;
  private charRow = 0;
  private uiActive = false;
  private lastHover: Course | null = null;
  private enterHint: Phaser.GameObjects.Text | null = null;

  constructor() { super('town'); }

  init(data: { charRow?: number }) { this.charRow = data.charRow ?? 0; }

  preload() {
    this.load.image('tiles', 'assets/tileset.png');
    this.load.image('tree_oak', 'assets/tree_oak.png');
    this.load.image('tree_pine', 'assets/tree_pine.png');
    this.load.image('bush', 'assets/bush.png');
    this.load.image('rock', 'assets/rock.png');
    this.load.image('fence', 'assets/fence.png');
    this.load.image('crops', 'assets/crops.png');
    this.load.image('sign', 'assets/sign.png');
    this.load.image('mailbox', 'assets/mailbox.png');
    ['b_townhall', 'b_barn', 'b_cottage', 'b_green', 'b_shop', 'b_dojo'].forEach(k =>
      this.load.image(k, `assets/${k}.png`));
    this.load.spritesheet('chars', 'assets/characters.png', { frameWidth: 16, frameHeight: 32 });
    this.load.spritesheet('npcs', 'assets/npcs.png', { frameWidth: 16, frameHeight: 32 });
  }

  // ---------- map building ----------
  private layout(): BuildingSpec[] {
    const b: BuildingSpec[] = [];
    // town hall centered at top
    const th = { key: 'b_townhall', x: MAP_W / 2 - 4, y: 2, w: 7, h: 6, doorX: MAP_W / 2 - 1, doorY: 8, townHall: true };
    b.push(th);
    // course slots: left col x=5, right col x=49 (6 tiles wide, 5 tall), rows y=2,14,26
    const rows = [2, 14, 26];
    COURSES.forEach((c, i) => {
      const left = i % 2 === 0;
      const row = rows[Math.floor(i / 2) % rows.length];
      const x = left ? 5 : MAP_W - 11;
      b.push({ course: c, key: c.building, x, y: row, w: 6, h: 5, doorX: x + 2, doorY: row + 5 });
    });
    return b;
  }

  private isPath(tx: number, ty: number) {
    // vertical main street x=29,30 — horizontal streets y=10,11 / 22,23 / 34,35
    if (tx === 29 || tx === 30) return true;
    if (ty === 10 || ty === 11 || ty === 22 || ty === 23 || ty === 34 || ty === 35) return true;
    // plaza around town hall
    if (ty === 8 || ty === 9) if (tx >= MAP_W / 2 - 6 && tx <= MAP_W / 2 + 4) return true;
    // connectors from each door to nearest horizontal street
    for (const bd of this.buildings) {
      if (bd.townHall) continue;
      const rowMid = bd.doorY <= 11 ? 10 : bd.doorY <= 23 ? 22 : 34;
      if (tx === bd.doorX || tx === bd.doorX + 1) {
        const lo = Math.min(bd.doorY, rowMid), hi = Math.max(bd.doorY, rowMid);
        if (ty >= lo && ty <= hi) return true;
      }
    }
    return false;
  }

  private tileAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return DGRASS;
    if (this.isPath(tx, ty)) {
      if (ty === 8 || ty === 9) return STONE;
      if (tx === 29 || tx === 30) return STONE;
      return DIRT;
    }
    // pond bottom-left
    const dx = tx - 4, dy = ty - 35;
    if (dx * dx / 22 + dy * dy / 10 < 1) return WATER;
    // crop field bottom-right
    if (tx >= 44 && tx <= 56 && ty >= 36 && ty <= 38) return TILL;
    const h = (tx * 73856093 ^ ty * 19349663) >>> 0;
    const r = h % 100;
    if (r < 4) return G_FLO_W;
    if (r < 8) return G_FLO_Y;
    if (r < 26) return G_TUFT;
    return G;
  }

  private buildGround() {
    const rt = this.add.renderTexture(0, 0, MAP_W * T, MAP_H * T).setOrigin(0).setDepth(-10);
    const tileset = this.textures.get('tiles').getSourceImage() as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = T; canvas.height = T;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const idx = this.tileAt(x, y);
        const sx = (idx % 8) * T, sy = Math.floor(idx / 8) * T;
        ctx.clearRect(0, 0, T, T);
        ctx.drawImage(tileset, sx, sy, T, T, 0, 0, T, T);
        rt.draw(canvas, x * T, y * T);
      }
    }
    // crops on tilled field
    for (let y = 36; y <= 38; y++) for (let x = 44; x <= 56; x++)
      rt.draw('crops', x * T, y * T);
  }

  private decorate() {
    // tree border
    const tree = (x: number, y: number, pine = false) => {
      this.add.image(x * T, y * T, pine ? 'tree_pine' : 'tree_oak').setOrigin(0.5, 1).setDepth(y * T + 2);
      this.blocked.add(`${x},${y}`);
    };
    for (let x = 0; x < MAP_W; x += 2) {
      if (x < 27 || x > 32) tree(x, 0, x % 4 === 0);
    }
    for (let y = 4; y < MAP_H; y += 3) { tree(0, y, y % 6 === 1); tree(MAP_W - 1, y, y % 6 === 4); }
    // scattered props
    const props: [string, number, number, boolean][] = [
      ['bush', 12, 12, false], ['bush', 44, 12, false], ['rock', 20, 17, true], ['rock', 38, 29, true],
      ['bush', 16, 30, false], ['bush', 42, 18, false], ['sign', 26, 11, true], ['sign', 32, 23, true],
      ['tree_oak', 14, 7, true], ['tree_pine', 46, 7, true], ['tree_oak', 12, 21, true],
      ['tree_pine', 47, 21, true], ['tree_oak', 20, 33, true], ['tree_pine', 39, 33, true],
      ['mailbox', 33, 8, true],
    ];
    for (const [k, x, y, solid] of props) {
      this.add.image(x * T, y * T + (k.startsWith('tree') ? 14 : 8), k).setOrigin(0.5, 1).setDepth(y * T + 4);
      if (solid) this.blocked.add(`${x},${y}`);
    }
    // fences around crop field
    for (let x = 43; x <= 57; x++) {
      this.add.image(x * T, 35 * T, 'fence').setDepth(35 * T);
      this.blocked.add(`${x},${35}`);
    }
    // water blocks
    for (let y = 33; y < MAP_H; y++) for (let x = 0; x < 10; x++) {
      const dx = x - 4, dy = y - 35;
      if (dx * dx / 22 + dy * dy / 10 < 1) this.blocked.add(`${x},${y}`);
    }
    // till blocks
    for (let y = 36; y <= 38; y++) for (let x = 44; x <= 56; x++) this.blocked.add(`${x},${y}`);
  }

  create() {
    this.buildings = this.layout();
    this.buildGround();
    this.decorate();

    // buildings
    for (const bd of this.buildings) {
      const img = this.add.image((bd.x + bd.w / 2) * T, (bd.y + bd.h) * T, bd.key)
        .setOrigin(0.5, 1).setDepth((bd.y + bd.h) * T);
      img.setInteractive({ useHandCursor: true });
      // block footprint
      for (let y = bd.y; y < bd.y + bd.h; y++) for (let x = bd.x; x < bd.x + bd.w; x++)
        this.blocked.add(`${x},${y}`);
      if (bd.course) this.doorZones.push({ x: bd.doorX, y: bd.doorY, course: bd.course });
    }

    // border walls
    for (let x = 0; x < MAP_W; x++) { this.blocked.add(`${x},-1`); this.blocked.add(`${x},${MAP_H}`); }
    for (let y = 0; y < MAP_H; y++) { this.blocked.add(`-1,${y}`); this.blocked.add(`${MAP_W},${y}`); }

    // player anims — characters.png: 16 frames/row = down(0-3) up(4-7) left(8-11) right(12-15)
    const base = this.charRow * 16;
    (['down', 'up', 'left', 'right'] as const).forEach((dir, di) => {
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers('chars', { start: base + di * 4, end: base + di * 4 + 3 }),
        frameRate: 8, repeat: -1,
      });
    });

    // player spawn: plaza below town hall
    this.player = this.add.sprite(MAP_W / 2 * T, 13 * T, 'chars', base).setDepth(13 * T);

    // NPCs wander the plaza
    NPCS.forEach((spec, i) => {
      const x = (MAP_W / 2 - 8 + i * 5) * T, y = (11 + (i % 2)) * T;
      const s = this.add.sprite(x, y, 'npcs', spec.sprite).setDepth(y);
      this.npcs.push({ spec, sprite: s, dir: new Phaser.Math.Vector2(0, 0), timer: 0, home: { x, y } });
    });

    // camera
    this.cameras.main.setBounds(0, 0, MAP_W * T, MAP_H * T);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.4);

    // input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE') as any;
    this.keyE = this.input.keyboard!.addKey('E');
    this.input.keyboard!.addKey('SPACE');

    // hover / tap interact
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onHover(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const wx = p.worldX, wy = p.worldY;
      // tap a door → enter if close
      for (const dz of this.doorZones) {
        const dx = dz.x * T + T / 2, dy = dz.y * T + T / 2;
        if (Math.abs(wx - dx) < T * 4 && Math.abs(wy - dy) < T * 4 &&
            dist(this.player.getCenter(), { x: dx, y: dy }) < T * 3.5) {
          this.enterBuilding(dz.course); return;
        }
      }
      this.tryInteract();
    });
    this.keyE.on('down', () => this.tryInteract());
    (this.wasd.SPACE as Phaser.Input.Keyboard.Key).on('down', () => this.tryInteract());

    // overlays pause movement
    bus.on('ui-open', () => { this.uiActive = true; this.player.anims.stop(); });
    bus.on('ui-close', () => { this.uiActive = false; });
    this.events.once('shutdown', () => { bus.off('ui-open'); bus.off('ui-close'); });
  }

  private onHover(p: Phaser.Input.Pointer) {
    if (this.uiActive) return;
    const tx = Math.floor(p.worldX / T), ty = Math.floor(p.worldY / T);
    let found: Course | null = null;
    for (const bd of this.buildings) {
      if (bd.course && tx >= bd.x - 1 && tx < bd.x + bd.w + 1 && ty >= bd.y - 1 && ty < bd.y + bd.h + 1) {
        found = bd.course; break;
      }
    }
    if (found !== this.lastHover) {
      this.lastHover = found;
      bus.emit('hover-building', { course: found, x: 0, y: 0 });
    }
    if (found) bus.emit('hover-building', { course: found, x: p.x, y: p.y });
  }

  private tryInteract() {
    if (this.uiActive || this.interactCooldown > 0) return;
    const pc = this.player.getCenter();
    // NPC within range?
    for (const n of this.npcs) {
      if (dist(pc, n.sprite.getCenter()) < T * 2.2) {
        bus.emit('npc-dialog', { npc: n.spec });
        this.interactCooldown = 400;
        return;
      }
    }
    // standing on/near a door?
    for (const dz of this.doorZones) {
      const dx = dz.x * T + T / 2, dy = dz.y * T + T / 2;
      if (dist(pc, { x: dx, y: dy }) < T * 1.6) {
        this.enterBuilding(dz.course);
        this.interactCooldown = 400;
        return;
      }
    }
  }

  private enterBuilding(course: Course) {
    bus.emit('enter-building', { course });
  }

  private nearDoor(): Course | null {
    const pc = this.player.getCenter();
    for (const dz of this.doorZones) {
      if (dist(pc, { x: dz.x * T + T / 2, y: dz.y * T + T / 2 }) < T * 1.6) return dz.course;
    }
    return null;
  }

  private nearNpc(): boolean {
    const pc = this.player.getCenter();
    return this.npcs.some(n => dist(pc, n.sprite.getCenter()) < T * 2.2);
  }

  private tileBlocked(px: number, py: number) {
    return this.blocked.has(`${Math.floor(px / T)},${Math.floor(py / T)}`);
  }

  private collides(x: number, y: number) {
    // sample a small box around the player's feet
    for (const [ox, oy] of [[-5, 0], [5, 0], [-5, 8], [5, 8], [0, 8]]) {
      if (this.tileBlocked(x + ox, y + oy)) return true;
    }
    return false;
  }

  update(_t: number, dt: number) {
    const d = Math.min(dt, 50) / 1000;
    if (this.interactCooldown > 0) this.interactCooldown -= dt;
    if (this.uiActive) return;

    // --- movement ---
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) vy += 1;
    if (input.x || input.y) { vx = input.x; vy = input.y; }
    if (input.interact) { input.interact = false; this.tryInteract(); }

    const len = Math.hypot(vx, vy);
    if (len > 0) {
      vx /= Math.max(1, len); vy /= Math.max(1, len);
      const nx = this.player.x + vx * SPEED * d;
      const ny = this.player.y + vy * SPEED * d;
      if (!this.collides(nx, this.player.y)) this.player.x = nx;
      if (!this.collides(this.player.x, ny)) this.player.y = ny;
      this.facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : (vy < 0 ? 'up' : 'down');
      this.player.anims.play(`walk-${this.facing}`, true);
    } else {
      this.player.anims.stop();
      const base = this.charRow * 16 + ({ down: 0, up: 4, left: 8, right: 12 } as const)[this.facing];
      this.player.setFrame(base);
    }
    this.player.setDepth(this.player.y);

    // --- hint near door / npc ---
    const door = this.nearDoor();
    const npcNear = this.nearNpc();
    let hintText: string | null = null;
    if (door) hintText = `Enter ${door.name}`;
    else if (npcNear) hintText = 'Talk';
    bus.emit('hint', { text: hintText });

    // --- NPC wander ---
    for (const n of this.npcs) {
      n.timer -= d;
      if (n.timer <= 0) {
        n.timer = 1.5 + Math.random() * 2.5;
        if (Math.random() < 0.4) n.dir.set(0, 0);
        else {
          const a = Math.random() * Math.PI * 2;
          n.dir.set(Math.cos(a), Math.sin(a)).normalize();
        }
      }
      const s = n.sprite;
      const nx = s.x + n.dir.x * 18 * d, ny = s.y + n.dir.y * 18 * d;
      // stay within 4 tiles of home and off blocked tiles
      if (Math.abs(nx - n.home.x) < 5 * T && Math.abs(ny - n.home.y) < 5 * T &&
          !this.tileBlocked(nx, ny + 8)) {
        s.x = nx; s.y = ny; s.setDepth(ny);
      } else n.timer = 0;
    }
  }
}
