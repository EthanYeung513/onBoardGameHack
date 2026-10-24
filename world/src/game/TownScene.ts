import Phaser from 'phaser';
import { COURSES, NPCS, type Course, type Npc } from '../config';
import { bus, input } from './bridge';
import { T, BUILDINGS, PROPS, generateWorld, type WorldSpec, type BuildingSpec } from '../worldgen';
import type { WeatherMode } from '../weather';

const SPEED = 85;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export class TownScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private keyE!: Phaser.Input.Keyboard.Key;
  private blocked!: Uint8Array;
  private sprites: Phaser.GameObjects.Image[] = [];
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

  private zoomOverride = 0;

  constructor() { super('town'); }

  // Zoom scales with the viewport so you always see a chunk of the world around
  // the player (~2-3x), and never drops below the zoom at which the map covers
  // the whole viewport (no void beside the map on big/wide screens).
  // ?zoom=Z (dev) wins outright; if the map is then smaller than the view,
  // the camera bounds centre it.
  private fitCamera() {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    cam.setSize(width, height);
    const W = this.world.w * T, H = this.world.h * T;
    const cover = Math.max(width / W, height / H);
    const pref = Phaser.Math.Clamp(Math.min(width, height) / (T * 18), 2, 3);
    const z = this.zoomOverride || Math.max(cover, pref);
    cam.setZoom(z);
    // pad the bounds to at least the view size so a too-small map is centred
    const bw = Math.max(W, width / z), bh = Math.max(H, height / z);
    cam.setBounds((W - bw) / 2, (H - bh) / 2, bw, bh);
  }

  init(data: { charRow?: number; weather?: WeatherMode }) {
    this.charRow = data.charRow ?? 0;
    this.weather = data.weather ?? 'sunny';
  }

  preload() {
    this.load.spritesheet('tiles', 'assets/tileset.png', { frameWidth: T, frameHeight: T });
    this.load.image('raindrop', 'assets/raindrop.png');
    // every texture the world DB references (props are rects on real SDV sheets)
    const texs = new Set<string>([...Object.values(PROPS).map(p => p.tex), 'fence', ...Object.keys(BUILDINGS)]);
    texs.forEach(k => this.load.image(k, `assets/${k}.png`));
    // real Stardew Valley villager sheets (4 cols x N rows of 16x32; rows: down/right/up/left)
    for (let i = 0; i < 6; i++)
      this.load.spritesheet(`p${i}`, `assets/p${i}.png`, { frameWidth: 16, frameHeight: 32 });
    for (let i = 0; i < 4; i++)
      this.load.spritesheet(`n${i}`, `assets/n${i}.png`, { frameWidth: 16, frameHeight: 32 });
  }

  // ---------- map drawing (layout comes entirely from worldgen) ----------
  private frameFor(tex: string, r: [number, number, number, number]) {
    const name = r.join(',');
    const t = this.textures.get(tex);
    if (!t.has(name)) t.add(name, 0, r[0], r[1], r[2], r[3]);
    return name;
  }

  private buildGround() {
    const { w, h, ground } = this.world;
    // ground tiles + flat decals (debris, tall grass) baked into one texture
    const rt = this.add.renderTexture(0, 0, w * T, h * T).setOrigin(0).setDepth(-10);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      rt.drawFrame('tiles', ground[y * w + x], x * T, y * T);
    for (const p of this.world.props) {
      if (!p.flat) continue;
      rt.drawFrame(p.tex, this.frameFor(p.tex, p.rect), Math.round(p.px), Math.round(p.py));
    }
  }

  private placeProps() {
    for (const p of this.world.props) {
      if (p.flat) continue;
      this.sprites.push(this.add.image(Math.round(p.px), Math.round(p.py), p.tex, this.frameFor(p.tex, p.rect))
        .setOrigin(0).setDepth(p.depth));
    }
  }

  create() {
    const q = new URLSearchParams(location.search);
    this.world = generateWorld(COURSES, Number(q.get('seed')) || undefined);
    this.buildings = this.world.buildings;
    this.blocked = this.world.blocked;
    this.buildGround();
    this.placeProps();
    if (import.meta.env.DEV && q.has('debug')) {
      // dev overlay: red = blocked, blue = door tiles
      const g = this.add.graphics().setDepth(1e6 + 2);
      g.fillStyle(0xff0000, 0.3);
      for (let i = 0; i < this.blocked.length; i++) if (this.blocked[i])
        g.fillRect((i % this.world.w) * T, Math.floor(i / this.world.w) * T, T, T);
      g.fillStyle(0x0066ff, 0.7);
      for (const bd of this.buildings) g.fillRect(bd.doorX * T, bd.doorY * T, T, T);
    }

    // buildings
    for (const bd of this.buildings) {
      const img = this.add.image((bd.x + bd.w / 2) * T, (bd.y + bd.h) * T, bd.key)
        .setOrigin(0.5, 1).setDepth((bd.y + bd.h) * T);
      img.setInteractive({ useHandCursor: true });
      if (bd.course) this.doorZones.push({ x: bd.doorX, y: bd.doorY, course: bd.course });
    }

    // player anims — SDV sheet: down(0-3) right(4-7) up(8-11) left(12-15)
    const pkey = `p${this.charRow}`;
    const ROWS = { down: 0, right: 4, up: 8, left: 12 } as const;
    (Object.keys(ROWS) as (keyof typeof ROWS)[]).forEach(dir => {
      if (this.anims.exists(`walk-${dir}`)) this.anims.remove(`walk-${dir}`); // scene restart: rebind to this char
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers(pkey, { start: ROWS[dir], end: ROWS[dir] + 3 }),
        frameRate: 8, repeat: -1,
      });
    });

    // player spawn: plaza below town hall (dev: ?at=tx,ty to jump around)
    const at = q.get('at')?.split(',').map(Number);
    const sp = at && at.length === 2 ? { x: at[0], y: at[1] } : this.world.spawn;
    this.player = this.add.sprite(sp.x * T + T / 2, sp.y * T, pkey, 0).setDepth(sp.y * T);

    // NPCs wander the plaza
    NPCS.forEach((spec, i) => {
      const home = this.world.npcHomes[i % this.world.npcHomes.length];
      const x = home.x * T + T / 2, y = home.y * T;
      const s = this.add.sprite(x, y, `n${spec.sprite}`, 0).setDepth(y);
      this.npcs.push({ spec, sprite: s, dir: new Phaser.Math.Vector2(0, 0), timer: 0, home: { x, y } });
    });

    // camera
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.zoomOverride = Number(q.get('zoom')) || 0;
    this.fitCamera();
    this.scale.on('resize', this.fitCamera, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.fitCamera, this));

    // input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D,E,SPACE') as any;
    this.keyE = this.input.keyboard!.addKey('E');
    this.input.keyboard!.addKey('SPACE');

    // hover / tap interact
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onHover(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const { x: wx, y: wy } = this.cameras.main.getWorldPoint(p.x, p.y);
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
    const fx: Phaser.GameObjects.GameObject[] = [];
    // oversized so it still covers the view after a resize
    if (a > 0) fx.push(this.add.rectangle(0, 0, 8192, 8192, col, a)
      .setOrigin(0).setScrollFactor(0).setDepth(1e6));
    if (this.weather === 'rain' || this.weather === 'storm' || this.weather === 'snow') {
      const n = this.weather === 'storm' ? 90 : 50;
      for (let i = 0; i < n; i++) {
        const d = this.add.image(Math.random() * width, Math.random() * height, 'raindrop')
          .setScrollFactor(0).setDepth(1e6 + 1).setAlpha(0.8).setScale(1.5);
        if (this.weather === 'snow') d.setTint(0xffffff).setAlpha(0.9).setScale(0.6);
        this.drops.push(d);
        fx.push(d);
      }
    }
    // weather lives in screen space: draw it with an unzoomed overlay camera
    if (fx.length) {
      const fxSet = new Set(fx);
      const ui = this.cameras.add(0, 0, width, height);
      ui.ignore(this.children.list.filter(o => !fxSet.has(o)));
      this.cameras.main.ignore(fx);
      const fit = (sz: Phaser.Structs.Size) => ui.setSize(sz.width, sz.height);
      this.scale.on('resize', fit);
      this.events.once('shutdown', () => this.scale.off('resize', fit));
    }
  }

  private onHover(p: Phaser.Input.Pointer) {
    if (this.uiActive) return;
    // main camera explicitly: the weather overlay camera sits on top
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const tx = Math.floor(wp.x / T), ty = Math.floor(wp.y / T);
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
    const tx = Math.floor(px / T), ty = Math.floor(py / T);
    if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) return true;
    return this.blocked[ty * this.world.w + tx] === 1;
  }

  private collides(x: number, y: number) {
    // sample a small box around the player's feet (sprite is 32 tall, origin centre)
    for (const [ox, oy] of [[-5, 7], [5, 7], [-5, 14], [5, 14], [0, 14]]) {
      if (this.tileBlocked(x + ox, y + oy)) return true;
    }
    return false;
  }

  // canvas renderer draws every visible child — hide props outside the camera
  private cull() {
    const v = this.cameras.main.worldView, m = 96;
    for (const s of this.sprites)
      s.setVisible(s.x < v.right + m && s.x + s.width > v.x - m && s.y < v.bottom + m && s.y + s.height > v.y - m);
  }

  update(_t: number, dt: number) {
    const d = Math.min(dt, 50) / 1000;
    this.cull();
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
    this.player.setDepth(this.player.y + 14); // feet, for y-sorting vs props

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
          !this.tileBlocked(nx, ny + 12)) {
        s.x = nx; s.y = ny; s.setDepth(ny + 14);
      } else n.timer = 0;
    }
  }
}
