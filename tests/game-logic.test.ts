import { describe, expect, it, vi } from "vitest";
import { EventBus, type GameEvents } from "@/game/events";
import { parseMap, step, type Dir, type Pos } from "@/game/logic";
import { DOORS, OFFICE_MAP, SPAWN } from "@/game/map";

const map = parseMap(OFFICE_MAP);
const never = () => 0.99;
const always = () => 0;

function walk(from: Pos, dirs: Dir[], opts = {}) {
  let pos = from;
  const events = [];
  for (const d of dirs) {
    const r = step(map, pos, d, { rng: never, ...opts });
    pos = r.pos;
    if (r.event) events.push(r.event);
  }
  return { pos, events };
}

describe("office map", () => {
  it("is rectangular, has every door, and spawns on the path", () => {
    expect(map.width).toBe(30);
    expect(map.height).toBe(20);
    for (const { building } of Object.values(DOORS)) expect(map.doorOf[building]).toBeDefined();
    expect(map.tiles[SPAWN.y][SPAWN.x]).toBe("path");
    expect(() => parseMap(["##", "#"])).toThrow(/width/);
    expect(() => parseMap(["#?"])).toThrow(/Unknown/);
  });
});

describe("step", () => {
  it("moves along the path and is blocked by walls and buildings", () => {
    expect(step(map, SPAWN, "right", { rng: never })).toMatchObject({ pos: { x: 16, y: 6 }, moved: true });
    expect(step(map, { x: 1, y: 1 }, "up", { rng: never })).toMatchObject({ pos: { x: 1, y: 1 }, moved: false });
    expect(step(map, { x: 2, y: 1 }, "down", { rng: never })).toMatchObject({ moved: false });
  });

  it("emits enter:gym at a door without moving into it", () => {
    const { pos, events } = walk(SPAWN, ["up", "up"]);
    expect(pos).toEqual({ x: 15, y: 5 });
    expect(events).toEqual([{ type: "enter:gym", building: "security" }]);
  });

  it("reports locked buildings", () => {
    const { events } = walk(SPAWN, ["down", "down", "down", "down", "down", "down", "down", "down"], { locked: new Set(["annex"]) });
    expect(events).toContainEqual({ type: "locked", building: "annex" });
  });

  it("triggers encounter:phish only in long grass, driven by the rng", () => {
    expect(step(map, { x: 5, y: 7 }, "down", { rng: always }).event).toEqual({ type: "encounter:phish" });
    expect(step(map, { x: 5, y: 7 }, "down", { rng: never }).event).toBeNull();
    expect(step(map, SPAWN, "right", { rng: always }).event).toBeNull();
  });
});

describe("EventBus", () => {
  it("delivers typed events and unsubscribes", () => {
    const bus = new EventBus<GameEvents>();
    const handler = vi.fn();
    const off = bus.on("enter:gym", handler);
    bus.emit("enter:gym", { building: "support" });
    off();
    bus.emit("enter:gym", { building: "support" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ building: "support" });
  });
});
