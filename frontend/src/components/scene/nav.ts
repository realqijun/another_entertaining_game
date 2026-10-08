import type { EquipmentId } from "@/sim";
import { deskSlot, GLASS, POS, ROOM, type Footprint } from "./layout";

/**
 * Walking around the building. Pure geometry on the floor plane (x, z),
 * so it can be tested without a renderer. Positions are presentation state
 * and never reach the simulation or the save.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** Axis-aligned rectangle on the floor, by its edges. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Half the engineer's width: how close their centre may get to a rack or a wall. */
export const RADIUS = 0.25;
/** How far from a footprint's edge the engineer can still use the equipment. */
export const REACH = 1.2;
export const CELL = 0.5;
/** Rounding slack, so a body standing exactly at the reach limit counts as in reach. */
const EPS = 1e-9;

export function rectOf(f: Footprint): Rect {
  return { minX: f.x - f.w / 2, maxX: f.x + f.w / 2, minZ: f.z - f.d / 2, maxZ: f.z + f.d / 2 };
}

const box = (x: number, z: number, w: number, d: number): Rect => ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

/** The glass partitions, as thin slabs. Door gaps are already left out of `GLASS`. */
const GLASS_T = 0.08;
export const WALLS: Rect[] = GLASS.map(([x1, z1, x2, z2]) => ({
  minX: Math.min(x1, x2) - GLASS_T / 2,
  maxX: Math.max(x1, x2) + GLASS_T / 2,
  minZ: Math.min(z1, z2) - GLASS_T / 2,
  maxZ: Math.max(z1, z2) + GLASS_T / 2,
}));

/**
 * Furniture the engineer walks around, as rough boxes matching what `Office`
 * draws. Small things (mugs, rugs, floor vents, wall frames) are left out, and
 * so are the people.
 */
export const FURNITURE: Rect[] = [
  // Engineering desks with their chairs tucked in, the whiteboard, plants and the coat rack
  ...Array.from({ length: 8 }, (_, i) => {
    const s = deskSlot(i);
    return box(s.x, s.z + (s.rot ? -0.15 : 0.15), 1.5, 1.1);
  }),
  box(-12.32, 7.4, 0.2, 2.1),
  box(-12.4, 5.6, 0.6, 0.6),
  box(-12.4, 9.5, 0.6, 0.6),
  box(-3.0, 5.6, 0.5, 0.5),
  box(2.2, 8.9, 0.6, 0.6),
  box(8.9, 5.6, 0.5, 0.5),
  // The growth desk and its results board
  box(POS.growth.x - 0.4, POS.growth.z + 0.35, 2.2, 1.1),
  // Server floor: cooling units, extinguisher, crash cart and boxed hardware
  box(-12.45, -2.6, 0.9, 1.4),
  box(-12.45, 2.2, 0.9, 1.4),
  box(-12.6, 4.4, 0.3, 0.3),
  box(5.3, -2.6, 0.95, 0.8),
  box(7.75, -4.05, 1.5, 0.75),
  // Monitoring room: the on-call desk
  box(8.2, -6.75, 1.8, 1.1),
  // Network and power room
  box(-21.45, -7.6, 0.9, 3.0),
  box(-18.0, -9.1, 3.8, 0.8),
  box(-14.2, -8.9, 0.6, 0.6),
  box(-14.3, -6.6, 0.7, 0.7),
  // Townhall steps and screen, the library and the phone booths
  box(-19.5, 4.5, 4.8, 6.6),
  box(-14.3, 4.5, 0.4, 2.3),
  box(-21.75, 11.65, 0.5, 4.1),
  box(-19.6, 10.8, 0.9, 0.9),
  box(-18.4, 12.6, 0.9, 0.9),
  box(-19.1, 11.9, 0.6, 0.6),
  box(-15.5, 13.8, 2.6, 1.4),
  // Meeting room
  box(-9.2, 12.35, 3.6, 2.6),
  box(-12.75, 12.35, 0.6, 1.6),
  // Reception and the waiting area
  box(3.2, 11.95, 3.3, 1.5),
  box(-2.2, 12.6, 2.8, 1.0),
  // Corridor: low bookshelf, vending machines, benches
  box(11.6, 5.45, 2.4, 0.5),
  box(13.15, -9.0, 2.0, 0.9),
  box(14.0, 1.6, 0.6, 1.6),
  // Kitchen
  box(18.5, -9.05, 7.0, 0.9),
  box(15.35, -9.05, 0.8, 0.9),
  box(21.6, -7.4, 0.8, 2.6),
  box(18.4, -6.2, 3.3, 1.1),
  box(18.45, -5.35, 1.4, 0.5),
  box(15.0, -4.0, 0.45, 0.45),
  // Dining table and chairs
  box(18.5, 0, 4.4, 2.4),
  // Lounge: couch, coffee table, armchair, TV and speakers, beanbags, games
  box(19.8, 6.5, 1.1, 2.4),
  box(18.0, 6.5, 0.7, 1.1),
  box(17.6, 8.8, 0.9, 0.9),
  box(15.3, 6.5, 0.6, 3.2),
  box(16.9, 4.4, 1.0, 1.0),
  box(16.6, 8.6, 1.0, 1.0),
  box(18.2, 12.6, 2.8, 1.6),
  box(20.85, 10.5, 1.7, 0.8),
];

/** Built equipment blocks the floor; dashed pads for equipment not yet built are walkable. */
export function obstacles(footprints: Record<EquipmentId, Footprint>, built: Record<EquipmentId, boolean>): Rect[] {
  return (Object.keys(footprints) as EquipmentId[]).filter((id) => built[id]).map((id) => rectOf(footprints[id]));
}

/** Everything that blocks the floor: built equipment, glass and furniture. */
export function blockers(footprints: Record<EquipmentId, Footprint>, built: Record<EquipmentId, boolean>): Rect[] {
  return [...obstacles(footprints, built), ...WALLS, ...FURNITURE];
}

function inside(p: Vec2, r: Rect, pad: number): boolean {
  return p.x > r.minX - pad && p.x < r.maxX + pad && p.z > r.minZ - pad && p.z < r.maxZ + pad;
}

function inRoom(p: Vec2, radius: number): boolean {
  return p.x >= ROOM.x0 + radius && p.x <= ROOM.x1 - radius && p.z >= ROOM.z0 + radius && p.z <= ROOM.z1 - radius;
}

/** True if a body of this radius can stand here. */
export function walkable(p: Vec2, blocks: Rect[], radius = RADIUS): boolean {
  return inRoom(p, radius) && !blocks.some((r) => inside(p, r, radius));
}

/**
 * Move from `pos` toward `next`, one axis at a time, so a body pushing
 * diagonally into a rack slides along its face instead of stopping dead.
 */
export function collide(pos: Vec2, next: Vec2, blocks: Rect[], radius = RADIUS): Vec2 {
  const clampX = (x: number) => Math.min(ROOM.x1 - radius, Math.max(ROOM.x0 + radius, x));
  const clampZ = (z: number) => Math.min(ROOM.z1 - radius, Math.max(ROOM.z0 + radius, z));
  let out = { x: pos.x, z: pos.z };
  const tryX = { x: clampX(next.x), z: out.z };
  if (!blocks.some((r) => inside(tryX, r, radius))) out = tryX;
  const tryZ = { x: out.x, z: clampZ(next.z) };
  if (!blocks.some((r) => inside(tryZ, r, radius))) out = tryZ;
  return out;
}

/** The point of a footprint closest to `p` (p itself when inside). */
function closestPoint(p: Vec2, f: Footprint): Vec2 {
  const r = rectOf(f);
  return { x: Math.min(r.maxX, Math.max(r.minX, p.x)), z: Math.min(r.maxZ, Math.max(r.minZ, p.z)) };
}

/** Distance from a point to the nearest edge of a footprint (zero inside it). */
export function distanceTo(p: Vec2, f: Footprint): number {
  const c = closestPoint(p, f);
  return Math.hypot(c.x - p.x, c.z - p.z);
}

/** True when the segment from a to b passes through any of the walls. */
function crosses(a: Vec2, b: Vec2, walls: Rect[]): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.04));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    if (walls.some((r) => inside(p, r, 0))) return true;
  }
  return false;
}

/** Within reach of the footprint, and not reaching through glass. */
export function inRange(p: Vec2, f: Footprint, reach = REACH, walls: Rect[] = WALLS): boolean {
  return distanceTo(p, f) <= reach + EPS && !crosses(p, closestPoint(p, f), walls);
}

/** The equipment the use key would act on: the closest one within reach. */
export function nearestInRange(
  p: Vec2,
  footprints: Record<EquipmentId, Footprint>,
  ids: readonly EquipmentId[],
  reach = REACH,
  walls: Rect[] = WALLS,
): EquipmentId | null {
  let best: EquipmentId | null = null;
  let bestD = Infinity;
  for (const id of ids) {
    const d = distanceTo(p, footprints[id]);
    if (d <= reach + EPS && d < bestD && !crosses(p, closestPoint(p, footprints[id]), walls)) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

/**
 * Standing spots just outside a footprint's edge, closest to `from` first.
 * Spots that are blocked, outside the room or behind glass are left out.
 */
export function approachPoints(f: Footprint, from: Vec2, blocks: Rect[], radius = RADIUS): Vec2[] {
  const r = rectOf(f);
  const gap = radius + 0.15;
  const out: Vec2[] = [];
  const step = 0.25;
  for (let x = r.minX; x <= r.maxX + 1e-6; x += step) {
    out.push({ x, z: r.minZ - gap }, { x, z: r.maxZ + gap });
  }
  for (let z = r.minZ; z <= r.maxZ + 1e-6; z += step) {
    out.push({ x: r.minX - gap, z }, { x: r.maxX + gap, z });
  }
  return out
    .filter((p) => walkable(p, blocks, radius) && inRange(p, f))
    .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
}

/* ------------------------------------------------------------------ */
/* Grid path finding                                                   */
/* ------------------------------------------------------------------ */

const COLS = Math.floor(ROOM.w / CELL);
const ROWS = Math.floor(ROOM.d / CELL);

const cellCentre = (c: number, r: number): Vec2 => ({ x: ROOM.x0 + (c + 0.5) * CELL, z: ROOM.z0 + (r + 0.5) * CELL });
const cellOf = (p: Vec2): [number, number] => [
  Math.min(COLS - 1, Math.max(0, Math.floor((p.x - ROOM.x0) / CELL))),
  Math.min(ROWS - 1, Math.max(0, Math.floor((p.z - ROOM.z0) / CELL))),
];

function grid(blocks: Rect[], radius: number): boolean[] {
  const open = new Array<boolean>(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) open[r * COLS + c] = walkable(cellCentre(c, r), blocks, radius);
  }
  return open;
}

/** The open cell nearest to a point, searching outward ring by ring. */
function nearestOpen(open: boolean[], p: Vec2): number | null {
  const [c0, r0] = cellOf(p);
  for (let ring = 0; ring < Math.max(COLS, ROWS); ring++) {
    let best: number | null = null;
    let bestD = Infinity;
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS || !open[r * COLS + c]) continue;
        const centre = cellCentre(c, r);
        const d = Math.hypot(centre.x - p.x, centre.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = r * COLS + c;
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/** A free spot to step out to when equipment has just been built where the engineer stands. */
export function escape(p: Vec2, blocks: Rect[], radius = RADIUS): Vec2 {
  if (walkable(p, blocks, radius)) return p;
  const cell = nearestOpen(grid(blocks, radius), p);
  return cell === null ? p : cellCentre(cell % COLS, Math.floor(cell / COLS));
}

function clearLine(a: Vec2, b: Vec2, blocks: Rect[], radius: number): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!walkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, blocks, radius)) return false;
  }
  return true;
}

/** Binary min-heap of cell indices keyed by f-score. */
class Frontier {
  private items: { i: number; f: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(i: number, f: number): void {
    const a = this.items;
    a.push({ i, f });
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (a[parent].f <= a[k].f) break;
      [a[parent], a[k]] = [a[k], a[parent]];
      k = parent;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0].i;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

/**
 * Waypoints from `from` to `to` around everything in the way (A* over a
 * half-metre grid, then shortcut wherever there is a clear straight line).
 * The first point is the first one to walk to; `from` itself is not included.
 * Returns null when the target cannot be reached.
 */
export function findPath(from: Vec2, to: Vec2, blocks: Rect[], radius = RADIUS): Vec2[] | null {
  if (!walkable(to, blocks, radius)) return null;
  if (clearLine(from, to, blocks, radius)) return [to];
  const open = grid(blocks, radius);
  const start = nearestOpen(open, from);
  const goal = nearestOpen(open, to);
  if (start === null || goal === null) return null;
  const gc = goal % COLS;
  const gr = Math.floor(goal / COLS);

  const g = new Float64Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const h = (i: number) => Math.hypot((i % COLS) - gc, Math.floor(i / COLS) - gr);
  const frontier = new Frontier();
  frontier.push(start, h(start));
  g[start] = 0;

  while (frontier.size > 0) {
    const i = frontier.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const n = nr * COLS + nc;
        if (!open[n] || closed[n]) continue;
        // No cutting corners past a blocked neighbour.
        if (dr && dc && (!open[r * COLS + nc] || !open[nr * COLS + c])) continue;
        const cost = g[i] + (dr && dc ? Math.SQRT2 : 1);
        if (cost < g[n]) {
          g[n] = cost;
          came[n] = i;
          frontier.push(n, cost + h(n));
        }
      }
    }
  }
  if (!closed[goal]) return null;

  const cells: Vec2[] = [];
  for (let i = goal; i !== -1; i = came[i]) cells.unshift(cellCentre(i % COLS, Math.floor(i / COLS)));
  const raw = [from, ...cells.slice(1), to];
  // String-pull: from each kept point, jump to the furthest point still in sight.
  const out: Vec2[] = [];
  let at = 0;
  while (at < raw.length - 1) {
    let next = raw.length - 1;
    while (next > at + 1 && !clearLine(raw[at], raw[next], blocks, radius)) next--;
    out.push(raw[next]);
    at = next;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Keyboard direction                                                  */
/* ------------------------------------------------------------------ */

export interface Held {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Where the default camera looks across the floor: down from +x, +z, so "up
 * the screen" is toward -x, -z. The scene passes the live direction, since the
 * player can turn the room.
 */
export const DEFAULT_FORWARD: Vec2 = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };

/**
 * Unit direction on the floor for the held keys, or null when they cancel out.
 * `forward` is the camera's view direction flattened onto the floor.
 */
export function moveDirection(k: Held, forward: Vec2 = DEFAULT_FORWARD): Vec2 | null {
  const v = (k.up ? 1 : 0) - (k.down ? 1 : 0);
  const h = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  if (!v && !h) return null;
  const fl = Math.hypot(forward.x, forward.z) || 1;
  const up = { x: forward.x / fl, z: forward.z / fl };
  // Screen right is the forward direction turned a quarter clockwise, seen from above.
  const right = { x: -up.z, z: up.x };
  const x = up.x * v + right.x * h;
  const z = up.z * v + right.z * h;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}
