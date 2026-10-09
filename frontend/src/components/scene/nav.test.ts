import { describe, expect, it } from 'vitest';
import type { EquipmentId } from '../../sim';
import { ROOM, type Footprint } from './layout';
import { collide, escape, FURNITURE, findPath, inRange, moveDirection, nearestInRange, RADIUS, walkable, WALLS, type Rect, type Vec2 } from './nav';

const fp = (x: number, z: number, w: number, d: number): Footprint => ({ x, z, w, d, h: 2 });
const rect = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

/** Every point along the path, from the start, at 5 cm spacing, is somewhere a body can stand. */
function walkablePath(from: Vec2, path: Vec2[], blocks: Rect[]): boolean {
  let at = from;
  for (const p of path) {
    const steps = Math.ceil(Math.hypot(p.x - at.x, p.z - at.z) / 0.05);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!walkable({ x: at.x + (p.x - at.x) * t, z: at.z + (p.z - at.z) * t }, blocks)) return false;
    }
    at = p;
  }
  return true;
}

describe('room navigation', () => {
  it('routes around a row of racks instead of through it', () => {
    const blocks = [rect(-4, 4, -0.5, 0.5)];
    const from = { x: 0, z: -3 };
    const to = { x: 0, z: 3 };
    const path = findPath(from, to, blocks)!;
    expect(path).not.toBeNull();
    expect(path.at(-1)).toEqual(to);
    expect(path.length).toBeGreaterThan(1);
    expect(walkablePath(from, path, blocks)).toBe(true);
  });

  it('walks straight when nothing is in the way', () => {
    expect(findPath({ x: 0, z: -3 }, { x: 0, z: 3 }, [rect(5, 6, 5, 6)])).toEqual([{ x: 0, z: 3 }]);
  });

  it('returns null for a target that is walled in or inside equipment', () => {
    const walls = [rect(3, 7, 3, 3.5), rect(3, 7, 6.5, 7), rect(3, 3.5, 3, 7), rect(6.5, 7, 3, 7)];
    expect(findPath({ x: 0, z: 0 }, { x: 5, z: 5 }, walls)).toBeNull();
    expect(findPath({ x: 0, z: 0 }, { x: 5, z: 3.2 }, walls)).toBeNull();
  });

  it('slides along a rack face instead of stopping or passing through it', () => {
    const blocks = [rect(-1, 1, 0, 2)];
    const slid = collide({ x: 0, z: -0.5 }, { x: 0.5, z: 0 }, blocks);
    expect(slid).toEqual({ x: 0.5, z: -0.5 });
    let pos = { x: 0, z: -2 };
    for (let i = 0; i < 100; i++) pos = collide(pos, { x: pos.x, z: pos.z + 0.1 }, blocks);
    expect(pos.z).toBeLessThanOrEqual(-RADIUS);
  });

  it('keeps the body inside the room', () => {
    expect(collide({ x: 0, z: 0 }, { x: 100, z: -100 }, [])).toEqual({ x: ROOM.x1 - RADIUS, z: ROOM.z0 + RADIUS });
    expect(collide({ x: 0, z: 0 }, { x: -100, z: 100 }, [])).toEqual({ x: ROOM.x0 + RADIUS, z: ROOM.z1 - RADIUS });
  });

  it('measures reach from the footprint edge, inclusive at the limit', () => {
    const f = fp(0, 0, 2, 2);
    expect(inRange({ x: 0, z: 0 }, f)).toBe(true);
    expect(inRange({ x: 2.2, z: 0 }, f)).toBe(true);
    expect(inRange({ x: 2.21, z: 0 }, f)).toBe(false);
    expect(inRange({ x: 1 + 0.9, z: 1 + 0.9 }, f)).toBe(false);
  });

  it('picks the closest of the equipment within reach, or nothing', () => {
    const footprints = { app: fp(0, 0, 2, 2), db: fp(4, 0, 2, 2) } as Record<EquipmentId, Footprint>;
    const ids: EquipmentId[] = ['app', 'db'];
    expect(nearestInRange({ x: 1.8, z: 0 }, footprints, ids)).toBe('app');
    expect(nearestInRange({ x: 2.3, z: 0 }, footprints, ids)).toBe('db');
    expect(nearestInRange({ x: 2, z: 5 }, footprints, ids)).toBeNull();
  });

  it('steps out of equipment built where the body stands', () => {
    const blocks = [rect(-1, 1, -1, 1)];
    const out = escape({ x: 0.2, z: 0 }, blocks);
    expect(walkable(out, blocks)).toBe(true);
    expect(Math.hypot(out.x - 0.2, out.z)).toBeLessThan(2);
  });

  it('maps keys to camera-relative floor directions', () => {
    const none = { up: false, down: false, left: false, right: false };
    const up = moveDirection({ ...none, up: true })!;
    expect(up.x).toBeCloseTo(-Math.SQRT1_2);
    expect(up.z).toBeCloseTo(-Math.SQRT1_2);
    const right = moveDirection({ ...none, right: true })!;
    expect(right.x).toBeCloseTo(Math.SQRT1_2);
    expect(right.z).toBeCloseTo(-Math.SQRT1_2);
    expect(Math.hypot(moveDirection({ ...none, up: true, right: true })!.x, moveDirection({ ...none, up: true, right: true })!.z)).toBeCloseTo(1);
    expect(moveDirection({ ...none, up: true, down: true })).toBeNull();
  });

  it('follows the camera when the room is turned', () => {
    const none = { up: false, down: false, left: false, right: false };
    // Looking straight along -z: up the screen is -z and right is +x.
    const up = moveDirection({ ...none, up: true }, { x: 0, z: -0.6 })!;
    expect(up.x).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(-1);
    const right = moveDirection({ ...none, right: true }, { x: 0, z: -0.6 })!;
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
    // Turned half way round, the same key walks the other way.
    const back = moveDirection({ ...none, up: true }, { x: Math.SQRT1_2, z: Math.SQRT1_2 })!;
    expect(back.x).toBeCloseTo(Math.SQRT1_2);
    expect(back.z).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('building navigation', () => {
  const blocks = [...WALLS, ...FURNITURE];

  it('stops at the server floor glass but walks through its door', () => {
    // Pushing straight at the glass between the office and the server floor.
    let pos = { x: 3, z: 6 };
    for (let i = 0; i < 60; i++) pos = collide(pos, { x: pos.x, z: pos.z - 0.1 }, blocks);
    expect(pos.z).toBeGreaterThan(5);
    // The same push through the door gap goes in.
    pos = { x: -1.4, z: 6 };
    for (let i = 0; i < 60; i++) pos = collide(pos, { x: pos.x, z: pos.z - 0.1 }, blocks);
    expect(pos.z).toBeLessThan(4);
  });

  it('paths from the office onto the server floor through a door', () => {
    const from = { x: 2.9, z: 6.2 };
    const to = { x: -5, z: -3.5 };
    const path = findPath(from, to, blocks)!;
    expect(path).not.toBeNull();
    expect(path.at(-1)).toEqual(to);
    expect(walkablePath(from, path, blocks)).toBe(true);
  });

  it('does not reach equipment through glass', () => {
    // A rack just behind the server floor glass, with the engineer on the office side.
    const behind = fp(3, 4.2, 1, 1);
    expect(inRange({ x: 3, z: 5.4 }, behind)).toBe(false);
    expect(nearestInRange({ x: 3, z: 5.4 }, { app: behind } as Record<EquipmentId, Footprint>, ['app'])).toBeNull();
    // Without the glass in the way it would be within reach.
    expect(inRange({ x: 3, z: 5.4 }, behind, undefined, [])).toBe(true);
  });

  it('keeps furniture inside the building', () => {
    for (const r of FURNITURE) {
      expect(r.minX).toBeGreaterThanOrEqual(ROOM.x0);
      expect(r.maxX).toBeLessThanOrEqual(ROOM.x1);
      expect(r.minZ).toBeGreaterThanOrEqual(ROOM.z0);
      expect(r.maxZ).toBeLessThanOrEqual(ROOM.z1);
    }
  });
});
