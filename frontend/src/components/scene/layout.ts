import { BALANCE, type EquipmentId, type GameState } from "@/sim";

/**
 * Floor plan of the building, in metres. X runs left to right, Z runs back to
 * front. The equipment keeps to the middle so the default view frames it; the
 * wings around it hold the network room, townhall, kitchen, lounge, meeting
 * room and reception.
 */
const X0 = -22;
const X1 = 22;
const Z0 = -9.5;
const Z1 = 14.5;
export const ROOM = { x0: X0, x1: X1, z0: Z0, z1: Z1, w: X1 - X0, d: Z1 - Z0, cx: (X0 + X1) / 2, cz: (Z0 + Z1) / 2, wallH: 3.4 };

/** Glass partition runs as [x1, z1, x2, z2]. Gaps for doors are already left out. */
export const GLASS: [number, number, number, number][] = [
  // Server floor
  [-13, 5, -2.0, 5],
  [-0.8, 5, 9, 5],
  [9, -4.6, 9, -0.2],
  [9, 1.0, 9, 5],
  [-13, -9.5, -13, -0.6],
  [-13, 0.6, -13, 5],
  // Monitoring room
  [5.5, -9.5, 5.5, -4.6],
  [5.5, -4.6, 9.6, -4.6],
  [10.6, -4.6, 11.5, -4.6],
  [11.5, -9.5, 11.5, -4.6],
  // Network and power room
  [-22, -1, -15.2, -1],
  [-14.0, -1, -13, -1],
  // Meeting room
  [-13, 10.2, -6.8, 10.2],
  [-5.9, 10.2, -5.5, 10.2],
  [-5.5, 10.2, -5.5, 14.5],
  [-13, 10.2, -13, 14.5],
];

export const RACK = { w: 0.95, d: 1.05, h: 2.1 };
export const DB_CABINET = { w: 1.25, d: 1.2, h: 2.25 };

export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Height of the tallest thing on the footprint; labels float above it. */
  h: number;
}

const APP_COLS = 6;
const APP_ORIGIN = { x: -6.6, z: -6.3 };
const APP_PITCH = { x: 1.3, z: 2.7 };

export function appSlot(index: number): { x: number; z: number } {
  return {
    x: APP_ORIGIN.x + (index % APP_COLS) * APP_PITCH.x,
    z: APP_ORIGIN.z + Math.floor(index / APP_COLS) * APP_PITCH.z,
  };
}

/** On-demand servers added by autoscaling stand in a row of their own. */
export function tempSlot(index: number): { x: number; z: number } {
  return { x: APP_ORIGIN.x + index * APP_PITCH.x, z: APP_ORIGIN.z + 2 * APP_PITCH.z };
}

export const MAX_TEMP_SHOWN = 6;

export function dbSlot(index: number): { x: number; z: number } {
  return { x: -3.4 + index * 1.42, z: 3.1 };
}

/** Where the cold aisle cable runs, between the two rows of app servers. */
export const AISLE_Z = -4.9;

/**
 * Engineers sit in pods of four: two desks facing two, monitors back to back.
 * `rot` turns the desk; at 0 the engineer sits on the +z side facing -z.
 */
export function deskSlot(index: number): { x: number; z: number; rot: number } {
  const pod = Math.floor(index / 4);
  const k = index % 4;
  const x = -9.6 + pod * 4.6 + (k % 2 === 0 ? -0.8 : 0.8);
  const back = k >= 2;
  return { x, z: 7.4 + (back ? -0.42 : 0.42), rot: back ? Math.PI : 0 };
}

export const POS = {
  gateway: { x: -11, z: -6.3 },
  loadBalancer: { x: -9.75, z: -6.3 },
  standby: { x: 2.7, z: -6.3 },
  cache: { x: -6.6, z: 3.1 },
  replica: { x: 3.9, z: 3.1 },
  backup: { x: 6.6, z: 3.1 },
  monitoring: { x: 8.2, z: -8.2 },
  deploy: { x: 0.4, z: 7.1 },
  growth: { x: 6.2, z: 7.1 },
};

function box(xs: number[], zs: number[], padX: number, padZ: number, h: number): Footprint {
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX + padX, d: maxZ - minZ + padZ, h };
}

export function footprint(s: GameState, id: EquipmentId): Footprint {
  switch (id) {
    case "gateway": {
      const lb = s.techDone.includes("load_balancing");
      return box([POS.gateway.x, lb ? POS.loadBalancer.x : POS.gateway.x], [POS.gateway.z], 1.5, 1.7, RACK.h);
    }
    case "app": {
      const n = Math.min(s.infra.appHosts.length, BALANCE.server.maxWithLb);
      const slots = Array.from({ length: n }, (_, i) => appSlot(i));
      const temps = Array.from({ length: Math.min(s.live.tempServers, MAX_TEMP_SHOWN) }, (_, i) => tempSlot(i));
      const all = [...slots, ...temps];
      return box(all.map((p) => p.x), all.map((p) => p.z), 1.5, 1.7, RACK.h);
    }
    case "standby":
      return { x: POS.standby.x, z: POS.standby.z, w: 1.5, d: 1.7, h: RACK.h };
    case "cache":
      return { x: POS.cache.x, z: POS.cache.z, w: 1.5, d: 1.7, h: 1.35 };
    case "db": {
      const n = s.infra.dbTier + 1;
      const slots = Array.from({ length: n }, (_, i) => dbSlot(i));
      return box(slots.map((p) => p.x), slots.map((p) => p.z), 1.8, 1.85, DB_CABINET.h);
    }
    case "replica":
      return { x: POS.replica.x, z: POS.replica.z, w: 1.8, d: 1.85, h: DB_CABINET.h };
    case "backup":
      return { x: POS.backup.x, z: POS.backup.z, w: 2.2, d: 1.7, h: 1.3 };
    case "monitoring":
      return { x: POS.monitoring.x, z: POS.monitoring.z, w: 5, d: 1.5, h: 3 };
    case "deploy":
      return { x: POS.deploy.x, z: POS.deploy.z, w: 2, d: 1.6, h: 1.5 };
    case "team": {
      const n = Math.max(1, s.engineers);
      const slots = Array.from({ length: n }, (_, i) => deskSlot(i));
      return box(slots.map((p) => p.x), slots.map((p) => p.z), 2.1, 2.0, 1.5);
    }
    case "growth":
      return { x: POS.growth.x, z: POS.growth.z, w: 3.4, d: 2.2, h: 2.1 };
  }
}
