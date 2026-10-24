import Phaser from 'phaser';
import { COURSES, NPCS, type Course, type Npc } from '../config';
import { bus, input } from './bridge';
import {
  T, MAP_W, MAP_H, G, G_TUFT, G_FLO_W, G_FLO_Y, DIRT, WATER, TILL, DGRASS,
  ST_N, ST_S, ST_W, ST_E, PLAZA, D_N, D_S, D_W, D_E, D_NW, D_NE, D_SW, D_SE, D_INT,
  generateWorld, key2, type WorldSpec, type BuildingSpec,
} from '../worldgen';
import type { WeatherMode } from '../weather';

const SPEED = 85;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

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
  private weather: WeatherMode = 'sunny';
  private world!: WorldSpec;
  private drops: Phaser.GameObjects.Image[] = [];
  private lastHover: Course | null = null;
  private enterHint: Phaser.GameObjects.Text | null = null;
  // Zombie scene instances (created then destroyed before their first shutdown,
  // e.g. React StrictMode remounts) keep their bus subscriptions — guard them off.
  private onUiOpen = () => {
    if (!this.sys.isActive()) return;
    this.uiActive = true;
    this.player?.anims.stop();
  };
  private onUiClose = () => { if (this.sys.isActive()) this.uiActive = false; };

  constructor() { super('town'); }

  init(data: { charRow?: number; weather?: WeatherMode }) {
    this.charRow = data.charRow ?? 0;
    this.weather = data.weather ?? 'sunny';
  }

  preload() {
    this.load.spritesheet('tiles', 'assets/tileset.png', { frameWidth: T, frameHeight: T });
    this.load.image('tree_oak', 'assets/tree_oak.png');
    this.load.image('tree_pine', 'assets/tree_pine.png');
    this.load.image('bush', 'assets/bush.png');
    this.load.image('rock', 'assets/rock.png');
    this.load.image('fence', 'assets/fence.png');
    this.load.image('crops', 'assets/crops.png');
    this.load.image('sign', 'assets/sign.png');
    this.load.image('mailbox', 'assets/mailbox.png');
    this.load.image('raindrop', 'assets/raindrop.png');
    ['b_townhall', 'b_shop', 'b_saloon', 'b_clinic', 'b_green', 'b_house', 'b_house2', 'b_trailer'].forEach(k =>
      this.load.image(k, `assets/${k}.png`));
    // real Stardew Valley villager sheets (4 cols x N rows of 16x32; rows: down/right/up/left)
    for (let i = 0; i < 6; i++)
      this.load.spritesheet(`p${i}`, `assets/p${i}.png`, { frameWidth: 16, frameHeight: 32 });
    for (let i = 0; i < 4; i++)
      this.load.spritesheet(`n${i}`, `assets/n${i}.png`, { frameWidth: 16, frameHeight: 32 });
  }

  // ---------- map building ----------
  private isPaved(tx: number, ty: number) { return this.world.paved.has(key2(tx, ty)); }
  private isDirt(tx: number, ty: number) { return this.world.dirt.has(key2(tx, ty)); }
  private isPath(tx: number, ty: number) { return this.isPaved(tx, ty) || this.isDirt(tx, ty); }

  // SDV-style autotile: pick the edge/corner variant by which neighbours
  // aren't path — this is what makes trails blur into the grass
  private edgeTile(tx: number, ty: number, set: [number, number, number, number, number, number, number, number], interior: number): number {
    const [N, S, W, E, NW, NE, SW, SE] = set;
    const n = this.isPath(tx, ty - 1), s = this.isPath(tx, ty + 1);
    const w = this.isPath(tx - 1, ty), e = this.isPath(tx + 1, ty);
    if (!n && w && e && s) return N;
    if (!s && w && e && n) return S;
    if (!w && n && s && e) return W;
    if (!e && n && s && w) return E;
    if (!n && !w && s && e) return NW;
    if (!n && !e && s && w) return NE;
    if (!s && !w && n && e) return SW;
    if (!s && !e && n && w) return SE;
    return interior;
  }

  private tileAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return DGRASS;
    if (this.isPaved(tx, ty)) {
      const t = this.edgeTile(tx, ty, [ST_N, ST_S, ST_W, ST_E, ST_N, ST_N, ST_S, ST_S], PLAZA);
      return t;
    }
    if (this.isDirt(tx, ty)) {
      const t = this.edgeTile(tx, ty, [D_N, D_S, D_W, D_E, D_NW, D_NE, D_SW, D_SE],
        D_INT[(tx * 7 + ty * 13) % D_INT.length]);
      return t;
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
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        rt.drawFrame('tiles', this.tileAt(x, y), x * T, y * T);
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
    this.world = generateWorld(COURSES);
    this.buildings = this.world.buildings;
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

    // player anims — SDV sheet: down(0-3) right(4-7) up(8-11) left(12-15)
    const pkey = `p${this.charRow}`;
    const ROWS = { down: 0, right: 4, up: 8, left: 12 } as const;
    (Object.keys(ROWS) as (keyof typeof ROWS)[]).forEach(dir => {
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers(pkey, { start: ROWS[dir], end: ROWS[dir] + 3 }),
        frameRate: 8, repeat: -1,
      });
    });

    // player spawn: plaza below town hall
    this.player = this.add.sprite(MAP_W / 2 * T, 13 * T, pkey, 0).setDepth(13 * T);

    // NPCs wander the plaza
    NPCS.forEach((spec, i) => {
      const x = (MAP_W / 2 - 8 + i * 5) * T, y = (11 + (i % 2)) * T;
      const s = this.add.sprite(x, y, `n${spec.sprite}`, 0).setDepth(y);
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
    bus.on('ui-open', this.onUiOpen);
    bus.on('ui-close', this.onUiClose);
    this.events.once('shutdown', () => { bus.off('ui-open', this.onUiOpen); bus.off('ui-close', this.onUiClose); });

    this.applyWeather();
  }

  // ---------- weather ----------
  private applyWeather() {
    const { width, height } = this.scale;
    const tints: Record<WeatherMode, [number, number]> = {
      sunny: [0x000000, 0],
      cloudy: [0x2a3a55, 0.18],
      rain: [0x1a2740, 0.28],
      storm: [0x101830, 0.42],
      snow: [0xaabbdd, 0.18],
    };
    const [col, a] = tints[this.weather];
    if (a > 0) this.add.rectangle(0, 0, width * 2, height * 2, col, a)
      .setOrigin(0).setScrollFactor(0).setDepth(900);
    if (this.weather === 'rain' || this.weather === 'storm' || this.weather === 'snow') {
      const n = this.weather === 'storm' ? 90 : 50;
      for (let i = 0; i < n; i++) {
        const d = this.add.image(Math.random() * width, Math.random() * height, 'raindrop')
          .setScrollFactor(0).setDepth(950).setAlpha(0.8);
        if (this.weather === 'snow') d.setTint(0xffffff).setAlpha(0.9);
        this.drops.push(d);
      }
    }
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
      if (dist(pc, { x: dx, y: dy }) < T * 2.5) {
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
      if (dist(pc, { x: dz.x * T + T / 2, y: dz.y * T + T / 2 }) < T * 2.5) return dz.course;
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
      const idle = ({ down: 0, right: 4, up: 8, left: 12 } as const)[this.facing];
      this.player.setFrame(idle);
    }
    this.player.setDepth(this.player.y);

    // --- hint near door / npc ---
    const door = this.nearDoor();
    const npcNear = this.nearNpc();
    let hintText: string | null = null;
    if (door) hintText = `Enter ${door.name}`;
    else if (npcNear) hintText = 'Talk';
    bus.emit('hint', { text: hintText });

    // re-evaluate hover every frame: the world moves under a stationary
    // pointer as the camera pans, so pointermove alone goes stale
    this.onHover(this.input.activePointer);

    // --- weather drops ---
    if (this.drops.length) {
      const vy = this.weather === 'snow' ? 40 : this.weather === 'storm' ? 420 : 300;
      const vx = this.weather === 'snow' ? 18 : -50;
      const w = this.scale.width, h = this.scale.height;
      for (const dr of this.drops) {
        dr.y += vy * d;
        dr.x += vx * d;
        if (dr.y > h + 16) { dr.y = -16; dr.x = Math.random() * w; }
        if (dr.x < -16) dr.x = w + 8;
      }
    }

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
