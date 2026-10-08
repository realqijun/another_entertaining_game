"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { deskSlot, GLASS, POS, ROOM } from "./layout";
import { look, Person, Walker, type Activity } from "./people";
import { ModelBatch, preloadModels, type ModelId, type Placement } from "./models";
import { ball, bx, cy, place, PrimBatch, type Prim, type V3 } from "./prims";
import { carpet, floorTiles, kitchenTiles, logoSign, poster, screenTexture, skyline, whiteboard, woodFloor, type PosterKind, type ScreenKind } from "./textures";
import { OnWall } from "./walls";

/*
 * Everything human in the building. The equipment sits on a glass-walled
 * server floor in the middle; around it are the engineering pods, the release
 * and growth desks, a monitoring room, a network and power room, townhall
 * steps, a library, a meeting room, reception, a kitchen, a dining table, a
 * lounge with games, and the people who use them.
 *
 * Furniture comes from two CC0 model packs (see models.tsx); fittings with no
 * matching model are boxes and cylinders (see prims.tsx). Both are drawn as
 * instanced meshes. Only screens, glass, signs and moving things are separate.
 */

const INK = "#1d1834";
const TRIM = "#2a2450";
const STEEL = "#34305c";
const WOOD = "#c98b55";
const WOOD_DARK = "#8a5a3c";
const CHAIR = "#ff9f43";
const LILAC = "#e8e4ff";
const PALE = "#d9d4f0";
const WHITE = "#f4f1ea";
const ALU = "#b9b2d9";
const MUGS = ["#4cb8ff", "#ff7ad9", "#3ddc84", "#ffc53d", "#a985ff", "#ff9f43"];
const BOOKS = ["#ff4d5e", "#4cb8ff", "#ffc53d", "#3ddc84", "#a985ff", "#ff9f43", "#f4f1ea", "#2dd4bf", "#ff7ad9"];

/** Where a point in a group's own frame ends up once the group is placed at (x, z) and turned by rot. */
function at(x: number, z: number, rot: number, l: V3): V3 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [x + l[0] * c + l[2] * s, l[1], z - l[0] * s + l[2] * c];
}

/** Deterministic pseudo-random, so the office looks the same on every load. */
function rand(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ------------------------------------------------------------------ */
/* Fittings with no matching model, as prims around their own origin   */
/* ------------------------------------------------------------------ */

function rug(w: number, d: number, outer: string, inner: string): Prim[] {
  return [bx([0, 0.007, 0], [w, 0.012, d], outer), bx([0, 0.009, 0], [w - 0.4, 0.013, d - 0.4], inner)];
}

function pizza(): Prim[] {
  return [
    bx([0, 0.025, 0], [0.46, 0.05, 0.46], "#e9d3a8", [0, 0.2, 0]),
    bx([0.03, 0.08, 0.02], [0.46, 0.05, 0.46], "#e9d3a8", [0, -0.15, 0]),
    bx([0.03, 0.108, 0.02], [0.2, 0.008, 0.2], "#ff4d5e", [0, -0.15, 0]),
    cy([0.42, 0.065, -0.1], 0.08, 0.13, "#ff4d5e"),
    cy([0.5, 0.065, 0.12], 0.08, 0.13, "#3ddc84"),
  ];
}

/** A bookshelf against a wall, facing +z. */
function shelf(w: number, h: number, seed: number): Prim[] {
  const out: Prim[] = [
    bx([0, h / 2, -0.18], [w, h, 0.04], WOOD_DARK),
    bx([-w / 2, h / 2, 0], [0.04, h, 0.4], WOOD_DARK),
    bx([w / 2, h / 2, 0], [0.04, h, 0.4], WOOD_DARK),
  ];
  const rows = Math.round(h / 0.45);
  for (let r = 0; r <= rows; r++) out.push(bx([0, (r * h) / rows, 0], [w, 0.04, 0.4], WOOD_DARK));
  for (let r = 0; r < rows; r++) {
    let x = -w / 2 + 0.06;
    let n = 0;
    while (x < w / 2 - 0.12) {
      const bw = 0.05 + rand(seed + r * 31 + n) * 0.06;
      const bh = 0.24 + rand(seed + r * 17 + n * 3) * 0.12;
      if (rand(seed + n * 7 + r) > 0.12) out.push(bx([x + bw / 2, (r * h) / rows + 0.02 + bh / 2, 0], [bw, bh, 0.26], BOOKS[Math.floor(rand(seed + n + r * 5) * BOOKS.length)]));
      x += bw + 0.01;
      n++;
    }
  }
  return out;
}

/** Arcade cabinet facing +z. Its screen is drawn separately. */
function arcade(color: string): Prim[] {
  return [
    bx([0, 0.9, 0], [0.72, 1.8, 0.75], color),
    bx([0, 1.25, 0.39], [0.6, 0.5, 0.04], INK, [-0.2, 0, 0]),
    bx([0, 0.93, 0.42], [0.66, 0.08, 0.3], INK),
    cy([-0.15, 0.99, 0.45], 0.04, 0.08, "#ff4d5e"),
    cy([0.1, 0.98, 0.45], 0.05, 0.03, "#ffd84a"),
    cy([0.22, 0.98, 0.45], 0.05, 0.03, "#4cb8ff"),
    bx([0, 1.68, 0.3], [0.66, 0.2, 0.22], "#ffd84a"),
  ];
}

function pingPong(): Prim[] {
  return [
    bx([0, 0.76, 0], [2.74, 0.06, 1.52], "#1f7a5c"),
    bx([0, 0.795, 0.745], [2.74, 0.012, 0.03], "#fff7e8"),
    bx([0, 0.795, -0.745], [2.74, 0.012, 0.03], "#fff7e8"),
    bx([1.355, 0.795, 0], [0.03, 0.012, 1.52], "#fff7e8"),
    bx([-1.355, 0.795, 0], [0.03, 0.012, 1.52], "#fff7e8"),
    bx([0, 0.795, 0], [2.74, 0.012, 0.015], "#fff7e8"),
    bx([0, 0.87, 0], [0.02, 0.15, 1.64], LILAC),
    ...[-1.1, 1.1].flatMap((dx) => [-0.6, 0.6].map((dz) => bx([dx, 0.37, dz], [0.07, 0.74, 0.07], TRIM))),
    cy([-0.9, 0.8, 0.45], 0.18, 0.02, "#ff4d5e"),
    cy([0.95, 0.8, -0.4], 0.18, 0.02, INK),
  ];
}

/** A phone booth facing +z, glazed at the front. */
function booth(color: string): Prim[] {
  return [
    bx([0, 1.15, -0.55], [1.2, 2.3, 0.08], color),
    bx([-0.6, 1.15, 0], [0.08, 2.3, 1.2], color),
    bx([0.6, 1.15, 0], [0.08, 2.3, 1.2], color),
    bx([0, 2.32, 0], [1.28, 0.08, 1.28], color),
    bx([0, 0.45, -0.3], [0.9, 0.08, 0.4], WHITE),
    bx([0, 0.02, 0], [1.2, 0.04, 1.2], TRIM),
    bx([0.3, 1.0, -0.45], [0.3, 0.2, 0.12], WOOD),
  ];
}

/* ------------------------------------------------------------------ */
/* The whole floor plan                                                */
/* ------------------------------------------------------------------ */

const GLASS_H = 2.6;

function glassFrames(): Prim[] {
  const out: Prim[] = [];
  for (const [x1, z1, x2, z2] of GLASS) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const alongX = z1 === z2;
    const mid: V3 = [(x1 + x2) / 2, 0, (z1 + z2) / 2];
    const rail = (y: number, h: number) => bx([mid[0], y, mid[2]], alongX ? [len, h, 0.08] : [0.08, h, len], ALU);
    out.push(rail(0.04, 0.08), rail(GLASS_H, 0.08));
    const posts = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i <= posts; i++) {
      const f = i / posts;
      out.push(bx([x1 + (x2 - x1) * f, GLASS_H / 2, z1 + (z2 - z1) * f], [0.07, GLASS_H, 0.07], ALU));
    }
  }
  return out;
}

const GLASS_MATERIAL = new THREE.MeshStandardMaterial({ color: "#a8d8ff", transparent: true, opacity: 0.14, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide });

function Glass() {
  return (
    <group>
      {GLASS.map(([x1, z1, x2, z2], i) => {
        const len = Math.hypot(x2 - x1, z2 - z1);
        return (
          <mesh key={i} position={[(x1 + x2) / 2, GLASS_H / 2, (z1 + z2) / 2]} rotation={[0, z1 === z2 ? 0 : Math.PI / 2, 0]} material={GLASS_MATERIAL}>
            <planeGeometry args={[len, GLASS_H - 0.08]} />
          </mesh>
        );
      })}
      {/* Phone booth fronts */}
      {[-16.2, -14.8].map((x) => (
        <mesh key={x} position={[x, 1.15, 14.2]} material={GLASS_MATERIAL}>
          <planeGeometry args={[1.12, 2.2]} />
        </mesh>
      ))}
    </group>
  );
}

function mdl(id: ModelId, x: number, z: number, rot = 0, s?: number | V3, y = 0): Placement {
  return { id, p: [x, y, z], rot, s };
}

/** Models built around the origin, placed at (x, z) and turned by rot. */
function placeModels(items: Placement[], x: number, z: number, rot = 0): Placement[] {
  return items.map((it) => ({ ...it, p: at(x, z, rot, it.p), rot: (it.rot ?? 0) + rot }));
}

const DESK_TOP = 0.74;
/** The lit panel of a desk monitor relative to its desk: centre height, front face and size. */
const PANEL = { y: 1.02, z: -0.168, w: 0.6, h: 0.36 };
const DESK_PLANTS: [ModelId, number][] = [
  ["plantSmall1", 1],
  ["cactusSmallA", 0.7],
  ["plantSmall3", 1],
  ["cactusSmallB", 0.7],
];

/** A desk facing -z with its chair on the +z side. The monitors' screens are drawn by `People`. */
function deskModels(w: number, i: number, monitors = 1): Placement[] {
  const xs = monitors === 1 ? [0] : [-0.45, 0.45];
  const out = [
    mdl("desk", 0, 0, 0, [w, DESK_TOP, 0.78]),
    ...xs.map((x) => mdl("screen", x, -0.2, 0, 0.85, DESK_TOP)),
    mdl("keyboard", 0, 0.14, 0, 0.85, DESK_TOP),
    mdl("mouse", 0.36, 0.16, 0, 1.1, DESK_TOP),
    mdl("chairDesk", 0, 0.72, Math.PI),
  ];
  if (i % 2 === 1) {
    const [id, s] = DESK_PLANTS[(i >> 1) % DESK_PLANTS.length];
    out.push(mdl(id, -w / 2 + 0.2, -0.18, i, s, DESK_TOP));
  }
  return out;
}

/** Everything that never moves and is not a model, as one list of prims. */
function buildStatic(): Prim[] {
  const out: Prim[] = [...glassFrames()];
  const add = (prims: Prim[], x: number, z: number, rot = 0, y = 0) => out.push(...place(prims, x, z, rot, y));

  // Mugs and papers on the engineers' desks, and the whiteboard's stand
  for (let i = 0; i < 8; i++) {
    const s = deskSlot(i);
    add([cy([0.55, 0.785, 0.08], 0.09, 0.09, MUGS[(i * 4 + 2) % MUGS.length]), ...(i % 2 === 0 ? [bx([-0.45, 0.745, 0.12], [0.22, 0.01, 0.3], "#fff7e8", [0, 0.25, 0])] : [])], s.x, s.z, s.rot);
  }
  add([bx([0, 0.45, 0], [0.06, 0.9, 1.3], ALU), bx([0, 1.4, 0], [0.04, 1.1, 2.1], ALU)], -12.32, 7.4);

  // Release console and the growth results board
  add([bx([0, 0.5, 0], [1.5, 1, 0.8], STEEL), bx([0, 1.28, -0.12], [1.17, 0.69, 0.05], INK, [-0.35, 0, 0]), bx([0.95, 0.6, 0.05], [0.3, 1.2, 0.6], TRIM)], POS.deploy.x, POS.deploy.z);
  add([cy([0, 0.55, 0], 0.08, 1.1, INK), bx([0, 1.5, 0], [1.27, 0.82, 0.05], INK)], POS.growth.x + 1.15, POS.growth.z - 0.55);

  // Server floor: cooling units, an extinguisher, a crash cart, floor vents
  for (const z of [-2.6, 2.2]) {
    add(
      [
        bx([0, 1.0, 0], [0.9, 2.0, 1.4], "#cbc4ea"),
        ...Array.from({ length: 7 }, (_, i) => bx([0.46, 0.45 + i * 0.18, 0], [0.02, 0.06, 1.1], "#5d5399")),
        bx([0.47, 1.75, -0.35], [0.02, 0.18, 0.3], INK),
        bx([0.48, 1.75, -0.35], [0.01, 0.06, 0.1], "#3ddc84"),
      ],
      -12.45,
      z,
    );
  }
  add([cy([0, 0.3, 0], 0.2, 0.55, "#ff4d5e"), cy([0, 0.62, 0], 0.08, 0.1, INK)], -12.6, 4.4);
  add(
    [
      bx([0, 0.27, 0], [0.8, 0.04, 0.55], ALU),
      bx([0, 0.77, 0], [0.8, 0.04, 0.55], ALU),
      ...[-0.37, 0.37].flatMap((dx) => [-0.24, 0.24].map((dz) => bx([dx, 0.42, dz], [0.04, 0.7, 0.04], "#5d5399"))),
      ...[-0.33, 0.33].flatMap((dx) => [-0.2, 0.2].map((dz) => cy([dx, 0.06, dz], 0.12, 0.05, INK))),
      bx([0, 0.8, 0.02], [0.4, 0.02, 0.28], PALE),
      bx([0, 0.93, -0.12], [0.4, 0.24, 0.02], PALE, [-0.3, 0, 0]),
      bx([0.2, 0.33, 0], [0.3, 0.12, 0.3], CHAIR),
    ],
    5.3,
    -2.6,
    0.4,
  );
  for (const [x, z] of [
    [-3.5, -4.95],
    [-0.9, -4.95],
    [4.3, -4.2],
    [6.4, -1.0],
    [0.9, 0.6],
  ]) {
    out.push(bx([x, 0.006, z], [0.86, 0.012, 0.86], "#8f87c9"));
    for (let i = 0; i < 16; i++) out.push(bx([x - 0.3 + (i % 4) * 0.2, 0.013, z - 0.3 + Math.floor(i / 4) * 0.2], [0.07, 0.004, 0.07], TRIM));
  }

  // Network and power room: batteries, UPS cabinets, fire suppression and a patch panel
  for (const z of [-8.6, -7.6, -6.6]) {
    add([bx([0, 0.95, 0], [0.9, 1.9, 0.95], LILAC), bx([0.46, 1.5, 0.1], [0.02, 0.14, 0.32], "#3ddc84"), ...Array.from({ length: 5 }, (_, i) => bx([0.46, 0.35 + i * 0.12, 0], [0.02, 0.05, 0.7], ALU))], -21.45, z);
  }
  for (const x of [-19.0, -17.0]) {
    out.push(bx([x, 0.8, -9.1], [1.7, 1.6, 0.04], ALU));
    for (let r = 0; r < 3; r++) {
      out.push(bx([x, 0.1 + r * 0.55, -8.95], [1.7, 0.04, 0.55], "#5d5399"));
      for (let c = 0; c < 6; c++) {
        out.push(bx([x - 0.68 + c * 0.27, 0.32 + r * 0.55, -8.95], [0.22, 0.36, 0.42], INK));
        out.push(bx([x - 0.72 + c * 0.27, 0.51 + r * 0.55, -9.05], [0.04, 0.03, 0.04], c % 2 ? "#ff4d5e" : INK));
      }
    }
  }
  add([cy([0, 0.8, 0], 0.5, 1.6, "#ff4d5e"), ball([0, 1.6, 0], [0.5, 0.3, 0.5], "#ff4d5e"), cy([0, 1.85, 0], 0.08, 0.2, ALU)], -14.2, -8.9);
  add([bx([0, 1.0, 0], [0.62, 2.0, 0.62], INK), ...Array.from({ length: 8 }, (_, i) => bx([0, 0.4 + i * 0.18, 0.32], [0.5, 0.06, 0.01], i % 3 ? "#3ddc84" : "#ffd84a"))], -14.3, -6.6);
  out.push(bx([-21.0, 0.008, -7.6], [0.06, 0.012, 3.6], "#ffc53d"), bx([-20.0, 0.008, -5.8], [2.0, 0.012, 0.06], "#ffc53d"));

  // Townhall steps facing a screen
  TIERS.forEach(([x, h], tier) => out.push(bx([x, h / 2, 4.5], [1.2, h, 6.6], tier % 2 ? WOOD : WOOD_DARK)));
  add([bx([0, 0.45, 0], [0.4, 0.9, 1.4], TRIM), bx([0, 1.5, 0], [0.08, 1.22, 2.3], INK)], -14.3, 4.5);

  // Library shelves and phone booths
  add(shelf(1.9, 2.0, 11), -21.75, 10.6, Math.PI / 2);
  add(shelf(1.9, 2.0, 23), -21.75, 12.7, Math.PI / 2);
  add(booth("#3e3570"), -16.2, 13.6);
  add(booth("#a985ff"), -14.8, 13.6);

  // Reception desk, a magazine in the waiting area and the doormat
  add([bx([0, 0.525, 0], [3.2, 1.05, 0.7], WHITE), bx([0, 1.075, 0.02], [3.3, 0.05, 0.8], WOOD), bx([0, 0.74, -0.52], [3.0, 0.04, 0.36], WOOD), bx([0.9, 1.12, 0.1], [0.3, 0.06, 0.2], "#ff7ad9")], 3.2, 12.3);
  out.push(bx([-2.1, 0.41, 12.6], [0.3, 0.02, 0.4], "#ffc53d", [0, 0.3, 0]));
  out.push(bx([3.2, 0.006, 13.95], [1.8, 0.012, 1.0], TRIM));

  // Corridor: a low bookshelf and vending machines
  add(shelf(2.4, 1.1, 37), 11.6, 5.45);
  add([bx([0, 0.95, 0], [0.9, 1.9, 0.8], "#ff4d5e"), bx([0, 1.25, 0.41], [0.6, 0.9, 0.02], "#a8d8ff"), bx([0, 0.35, 0.41], [0.6, 0.12, 0.02], INK)], 12.6, -9.0);
  add([bx([0, 0.95, 0], [0.9, 1.9, 0.8], "#4cb8ff"), bx([0, 1.25, 0.41], [0.6, 0.9, 0.02], "#a8d8ff"), bx([0, 0.35, 0.41], [0.6, 0.12, 0.02], INK)], 13.7, -9.0);

  // Fruit on the kitchen island and a water cooler
  out.push(ball([18.4, 0.86, -6.2], [0.36, 0.12, 0.36], WHITE), ball([18.35, 0.93, -6.15], [0.1, 0.1, 0.1], "#ff4d5e"), ball([18.48, 0.93, -6.25], [0.1, 0.1, 0.1], "#ffc53d"));
  add([bx([0, 0.5, 0], [0.38, 1.0, 0.38], LILAC), cy([0, 1.22, 0], 0.32, 0.42, "#4cb8ff")], 15.0, -4.0);

  // The remains of pizza night
  add(pizza(), 17.8, -0.1, 0, 0.76);
  add(pizza(), 19.4, 0.15, 1.2, 0.76);

  // Rugs in the lounge and the library, beanbags and the games corner
  add(rug(5.0, 4.6, "#6b4aa0", "#7d5bb8"), 18.4, 6.5);
  out.push(cy([-19.2, 0.007, 11.7], 2.8, 0.012, "#6b4aa0"), cy([-19.2, 0.009, 11.7], 2.4, 0.013, "#7d5bb8"));
  out.push(ball([16.9, 0.26, 4.4], [0.96, 0.58, 0.96], "#2dd4bf"), ball([16.6, 0.26, 8.6], [0.96, 0.58, 0.96], "#ff7ad9"));
  add(pingPong(), 18.2, 12.6);
  add(arcade("#a985ff"), 20.4, 10.5);
  add(arcade("#ff4d5e"), 21.3, 10.5);
  return out;
}

/** Townhall tiers as [x, height]. */
const TIERS: [number, number][] = [
  [-21.3, 1.6],
  [-20.1, 1.2],
  [-18.9, 0.8],
  [-17.7, 0.4],
];

/** The two televisions: where they stand and their scale. */
const MEETING_TV = { x: -12.75, z: 12.35, y: 0.54, s: 1.15 };
const LOUNGE_TV = { x: 15.3, z: 6.5, y: 0.6, s: 1.25 };

/** The picture on a television model turned to face +x: centre and size. */
function tvPicture(tv: { x: number; z: number; y: number; s: number }): { position: V3; w: number; h: number } {
  return { position: [tv.x + 0.041 * tv.s + 0.006, tv.y + 0.506 * tv.s, tv.z], w: 1.25 * tv.s, h: 0.69 * tv.s };
}

/** Furniture models: desks, chairs, the kitchen, sofas, tables, lamps, plants and more. */
function buildModels(): Placement[] {
  const out: Placement[] = [];
  const add = (items: Placement[], x: number, z: number, rot = 0) => out.push(...placeModels(items, x, z, rot));

  // Engineering pods, the growth desk and the on-call desk
  for (let i = 0; i < 8; i++) {
    const s = deskSlot(i);
    add(deskModels(1.5, i), s.x, s.z, s.rot);
  }
  add(deskModels(2.2, 9, 2), POS.growth.x - 0.4, POS.growth.z + 0.2);
  add(deskModels(1.8, 12, 2), 8.2, -6.9);
  out.push(mdl("pottedPlant", -12.4, 5.6), mdl("pottedPlant", -12.4, 9.5), mdl("coatRack", -3.0, 5.6), mdl("trashcan", -3.0, 9.0, 0, 0.8));
  out.push(mdl("pottedPlant", 2.2, 8.9), mdl("cactusMedium", 8.9, 5.6, 0, 1.5));

  // Hardware waiting to be installed
  out.push(mdl("boxClosed", 7.3, -4.1, 0.2, 1.3), mdl("boxClosed", 7.32, -4.1, 0.5, 1.1, 0.7), mdl("boxOpen", 8.2, -4.0, -0.3, 1.1));

  // Cushions on the townhall steps, leaving room for the reader
  TIERS.forEach(([x, h], tier) => {
    for (let k = 0; k < 4; k++) {
      if ((tier * 3 + k) % 4 === 1 || (tier === 2 && k === 1)) continue;
      out.push(mdl(k % 2 ? "pillowA" : "pillowB", x + 0.1, 2.2 + k * 1.5, tier * 0.7 + k, 1.4, h));
    }
  });

  // Library corner
  out.push(mdl("armchair", -19.6, 10.8, Math.PI / 2, 0.95), mdl("armchair", -18.4, 12.6, Math.PI, 0.95));
  out.push(mdl("sideTable", -19.1, 11.9, Math.PI / 4, 0.7), mdl("lampTable", -19.1, 11.9, 0, 0.9, 0.52), mdl("lampRoundFloor", -20.9, 13.7), mdl("pottedPlant", -14.0, 9.5, 0, 1.1));

  // Meeting room
  out.push(mdl("tableLong", -9.2, 12.35, 0, [3.4, 0.74, 1.3]));
  for (const x of [-10.4, -9.2, -8.0]) out.push(mdl("chairModern", x, 11.42, 0, 1.2), mdl("chairModern", x, 13.28, Math.PI, 1.2));
  out.push(mdl("tvCabinet", MEETING_TV.x, MEETING_TV.z, Math.PI / 2, 0.9), mdl("tv", MEETING_TV.x, MEETING_TV.z, Math.PI / 2, MEETING_TV.s, MEETING_TV.y), mdl("pottedPlant", -6.0, 14.0));

  // Reception and the waiting area
  out.push(mdl("screen", 3.2, 11.8, Math.PI, 0.75, 0.76), mdl("chairDesk", 3.2, 11.3), mdl("pottedPlant", 6.4, 13.9), mdl("coatRack", 5.6, 13.9));
  out.push(mdl("armchair", -3.2, 12.6, Math.PI / 2, 0.85), mdl("armchair", -1.2, 12.6, -Math.PI / 2, 0.85), mdl("tableCoffee", -2.2, 12.6, Math.PI / 2, 0.9), mdl("cactusMedium", -4.4, 13.9, 0, 1.6));

  // Corridor
  out.push(mdl("bench", 14.0, 1.2, -Math.PI / 2), mdl("bench", 14.0, 2.0, -Math.PI / 2), mdl("pottedPlant", 13.9, 9.6), mdl("pottedPlant", 13.9, -4.0), mdl("cactusMedium", 9.6, 4.4, 0, 1.4));

  // Kitchen: cabinets along the back and side walls, an island with stools
  const run: ModelId[] = ["cabinetDrawer", "cabinet", "sink", "cabinet", "stove", "cabinetDrawer", "cabinet"];
  run.forEach((id, i) => out.push(mdl(id, 16.4 + i * 0.83, -9.06)));
  for (const z of [-8.2, -7.37, -6.54]) out.push(mdl("cabinet", 21.565, z, -Math.PI / 2));
  out.push(mdl("fridge", 15.35, -9.1), mdl("coffeeMachine", 17.23, -9.15, 0, 1, 0.87), mdl("microwave", 20.55, -9.15, 0, 1, 0.87), mdl("blender", 16.4, -9.2, 0, 1, 0.87), mdl("toaster", 21.5, -7.37, -Math.PI / 2, 1, 0.87));
  for (const x of [17.57, 18.4, 19.23]) out.push(mdl("bar", x, -6.0), mdl("bar", x, -6.4, Math.PI));
  for (const x of [17.06, 19.74]) out.push(mdl("barEnd", x, -6.0), mdl("barEnd", x, -6.4, Math.PI));
  for (const x of [18.0, 18.9]) out.push(mdl("stoolBar", x, -5.35, Math.PI));
  out.push(mdl("trashcan", 15.1, -7.6, 0, 0.8));

  // Dining table and chairs
  out.push(mdl("tableLong", 18.5, 0, 0, [4.0, 0.75, 1.1]));
  for (const x of [17.1, 18.5, 19.9]) out.push(mdl("chairCushion", x, -0.85, 0, 1.15), mdl("chairCushion", x, 0.85, Math.PI, 1.15));
  out.push(mdl("pottedPlant", 15.0, 2.6), mdl("cactusMedium", 21.4, -2.6, 0, 1.5));

  // Lounge: a couch facing the TV, an armchair and a lamp
  out.push(mdl("couch", 19.8, 6.5, -Math.PI / 2, 1.2), mdl("loungeChair", 17.6, 8.8, Math.PI, 0.9), mdl("tableCoffeeGlass", 18.0, 6.5, Math.PI / 2, 0.9));
  out.push(mdl("tvCabinet", LOUNGE_TV.x, LOUNGE_TV.z, Math.PI / 2), mdl("tv", LOUNGE_TV.x, LOUNGE_TV.z, Math.PI / 2, LOUNGE_TV.s, LOUNGE_TV.y), mdl("speaker", 15.3, 5.1), mdl("speaker", 15.3, 7.9));
  out.push(mdl("lampSquareFloor", 21.3, 4.1), mdl("pottedPlant", 21.4, 9.3), mdl("pottedPlant", 15.0, 13.9));
  return out;
}

/** Picture frames on the left wall (frame bottoms at y) and the posters inside them (centred at mid). */
const FRAMES: { id: ModelId; z: number; y: number; poster: PosterKind; w: number; h: number; mid: number }[] = [
  { id: "frameLargeA", z: 1.3, y: 1.75, poster: "launch", w: 0.72, h: 0.88, mid: 2.305 },
  { id: "frameMedium", z: 7.6, y: 1.8, poster: "growth", w: 0.47, h: 0.64, mid: 2.22 },
];
const FRAME_X = ROOM.x0 + 0.1;

/** Fixed to a wall, drawn only while the wall stands. */
function buildWallMounted(): { back: Placement[]; left: Placement[]; leftPrims: Prim[] } {
  return {
    back: [16.4, 17.23, 20.55, 21.38].map((x) => mdl("cabinetUpper", x, -9.29, 0, 1, 1.55)),
    left: FRAMES.map((f) => mdl(f.id, FRAME_X, f.z, Math.PI / 2, 1.5, f.y)),
    leftPrims: [bx([-21.93, 1.5, -3.2], [0.1, 1.2, 0.9], ALU), bx([-21.87, 1.7, -3.0], [0.02, 0.2, 0.3], "#ffd84a")],
  };
}

/* ------------------------------------------------------------------ */
/* Screens, signs and other special surfaces                           */
/* ------------------------------------------------------------------ */

function ScreenPlane({ kind, w, h, position, rot = 0, tilt = 0 }: { kind: ScreenKind; w: number; h: number; position: V3; rot?: number; tilt?: number }) {
  const map = useMemo(() => screenTexture(kind), [kind]);
  const rotation = useMemo(() => new THREE.Euler(tilt, rot, 0, "YXZ"), [tilt, rot]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={map} toneMapped={false} />
    </mesh>
  );
}

/** A window onto the city at night. Faces +z before rotation. */
function CityWindow({ position, rot = 0, w, h }: { position: V3; rot?: number; w: number; h: number }) {
  const tex = useMemo(() => skyline(), []);
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <mesh>
        <boxGeometry args={[w + 0.16, h + 0.16, 0.06]} />
        <meshStandardMaterial color={TRIM} />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[0.06, h, 0.03]} />
        <meshStandardMaterial color={TRIM} />
      </mesh>
    </group>
  );
}

function NeonLogo({ position, rot }: { position: V3; rot: number }) {
  const tex = useMemo(() => logoSign(), []);
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <mesh>
        <boxGeometry args={[3.6, 1.2, 0.05]} />
        <meshStandardMaterial color={INK} />
      </mesh>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[3.5, 1.1]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A poster inside one of the wall frames, just behind the frame's front edge. */
function Poster({ kind, position, w, h }: { kind: PosterKind; position: V3; w: number; h: number }) {
  const map = useMemo(() => poster(kind), [kind]);
  return (
    <mesh position={position} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[w, h]} />
      <meshLambertMaterial map={map} />
    </mesh>
  );
}

function WhiteboardFace({ position, rot }: { position: V3; rot: number }) {
  const tex = useMemo(() => whiteboard(), []);
  return (
    <mesh position={position} rotation={[0, rot, 0]}>
      <planeGeometry args={[2.0, 1.0]} />
      <meshStandardMaterial map={tex} roughness={0.6} />
    </mesh>
  );
}

type FloorKey = "server" | "wood" | "noc" | "meeting" | "kitchen";

/** Floor finishes by zone, as [finish, centre x, centre z, width, depth, tile size]. */
const ZONES: [FloorKey, number, number, number, number, number][] = [
  ["server", -3.75, -2.25, 18.5, 14.5, 0.9],
  ["server", 7.25, 0.2, 3.5, 9.6, 0.9],
  ["noc", 8.5, -7.05, 6, 4.9, 1.2],
  ["wood", 0.75, 7.6, 27.5, 5.2, 1.6],
  ["wood", 4.5, 12.35, 20, 4.3, 1.6],
  ["wood", -17.5, 6.75, 9, 15.5, 1.6],
  ["wood", 18.25, 5.75, 7.5, 17.5, 1.6],
  ["meeting", -9.25, 12.35, 7.5, 4.3, 1.2],
  ["kitchen", 18.25, -6.25, 7.5, 6.5, 0.8],
];

function Floors() {
  const textures = useMemo(() => {
    const base: Record<FloorKey, THREE.CanvasTexture> = {
      server: floorTiles(),
      wood: woodFloor(),
      noc: carpet("#2f3f73", "#26335e"),
      meeting: carpet("#7d5bb8", "#6b4aa0"),
      kitchen: kitchenTiles(),
    };
    return ZONES.map(([key, , , w, d, tile]) => {
      const t = base[key].clone();
      t.repeat.set(w / tile, d / tile);
      t.needsUpdate = true;
      return t;
    });
  }, []);
  return (
    <group>
      {ZONES.map(([, x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.004, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[w, d]} />
          <meshLambertMaterial map={textures[i]} />
        </mesh>
      ))}
    </group>
  );
}

function PingPongBall() {
  const ball = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ball.current) return;
    // A rally that never ends: the ball crosses the net and bounces on each side.
    const t = clock.elapsedTime * 0.9;
    const f = t % 2;
    const x = f < 1 ? -1.1 + f * 2.2 : 1.1 - (f - 1) * 2.2;
    ball.current.position.set(18.2 + x, 0.82 + Math.abs(Math.sin(t * Math.PI * 2)) * 0.3, 12.6 + Math.sin(t * 1.3) * 0.35);
  });
  return (
    <mesh ref={ball}>
      <sphereGeometry args={[0.035, 8, 6]} />
      <meshBasicMaterial color="#fff7e8" />
    </mesh>
  );
}

/** Red beacon above the monitoring wall that spins up during an incident. */
function Beacon({ on }: { on: boolean }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const pulse = on ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 8) : 0;
    if (lamp.current) lamp.current.emissiveIntensity = on ? 0.6 + pulse * 2.4 : 0.15;
    if (halo.current) halo.current.opacity = pulse * 0.45;
  });
  return (
    <group position={[5.9, 2.9, ROOM.z0 + 0.2]}>
      <mesh position={[0, -0.1, 0]}>
        <boxGeometry args={[0.3, 0.08, 0.3]} />
        <meshStandardMaterial color={TRIM} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <sphereGeometry args={[0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial ref={lamp} color="#ff4d5e" emissive="#ff4d5e" emissiveIntensity={0.15} toneMapped={false} />
      </mesh>
      {/* A soft red glow on the wall behind it, standing in for a light. */}
      <mesh position={[0, 0, 0.02]}>
        <circleGeometry args={[1.4, 24]} />
        <meshBasicMaterial ref={halo} color="#ff4d5e" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function WallClock({ position }: { position: V3 }) {
  const hand = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (hand.current) hand.current.rotation.z = -clock.elapsedTime * 0.6;
  });
  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.05, 16]} />
        <meshStandardMaterial color="#fff7e8" roughness={0.7} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.005]}>
        <cylinderGeometry args={[0.36, 0.36, 0.04, 16]} />
        <meshStandardMaterial color={INK} />
      </mesh>
      <mesh ref={hand} position={[0, 0, 0.04]}>
        <boxGeometry args={[0.02, 0.5, 0.01]} />
        <meshBasicMaterial color="#ff4d5e" />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export interface Crew {
  engineers: number;
  busy: number;
  incident: boolean;
  releases: number;
  promos: number;
}

type Seat = "type" | "relax" | "mug" | "kitchen" | "lounge";

/**
 * Where engineer i is. Assigned engineers code at their desks. The first free
 * engineer is in the kitchen and the second on the lounge sofa, so idle staff
 * show up in the building. During an incident everyone is back at a keyboard.
 */
function seatFor(i: number, crew: Crew): Seat {
  if (crew.incident || i < crew.busy) return "type";
  const free = i - crew.busy;
  if (free === 0) return "kitchen";
  if (free === 1) return "lounge";
  return free % 2 ? "mug" : "relax";
}

function People({ crew }: { crew: Crew }) {
  const meetingTv = tvPicture(MEETING_TV);
  const loungeTv = tvPicture(LOUNGE_TV);
  return (
    <group>
      {Array.from({ length: 8 }, (_, i) => {
        const slot = deskSlot(i);
        const hired = i < crew.engineers;
        const seat = hired ? seatFor(i, crew) : null;
        const screen: ScreenKind = !hired ? "off" : seat === "type" ? "code" : "idle";
        return (
          <group key={i}>
            <ScreenPlane kind={screen} w={PANEL.w} h={PANEL.h} position={at(slot.x, slot.z, slot.rot, [0, PANEL.y, PANEL.z])} rot={slot.rot} />
            {seat && seat !== "kitchen" && seat !== "lounge" && (
              <Person pose="sit" activity={seat as Activity} look={look(i)} position={at(slot.x, slot.z, slot.rot, [0, 0, 0.72])} rotation={slot.rot} phase={i * 1.7} />
            )}
            {seat === "kitchen" && <Person pose="stand" activity="mug" look={look(i)} position={[16.6, 0, -5.7]} rotation={-2.4} phase={i} />}
            {seat === "lounge" && <Person pose="sit" activity="laptop" look={look(i)} position={[19.9, 0, 5.9]} rotation={Math.PI / 2} phase={i} />}
          </group>
        );
      })}

      {/* Release engineer, marketer, on-call engineer and receptionist */}
      <ScreenPlane kind={crew.releases > 0 ? "deploy-busy" : "deploy"} w={1.1} h={0.62} position={[POS.deploy.x, 1.28, POS.deploy.z - 0.09]} tilt={-0.35} />
      <Person pose="stand" activity={crew.releases > 0 || crew.incident ? "type" : "chat"} look={look(11)} position={[POS.deploy.x, 0, POS.deploy.z + 0.78]} phase={3} />
      {[-0.45, 0.45].map((dx) => (
        <ScreenPlane key={dx} kind={crew.promos > 0 ? "chart" : "idle"} w={PANEL.w} h={PANEL.h} position={[POS.growth.x - 0.4 + dx, PANEL.y, POS.growth.z + 0.2 + PANEL.z]} />
      ))}
      <ScreenPlane kind="chart" w={1.2} h={0.75} position={[POS.growth.x + 1.15, 1.5, POS.growth.z - 0.52]} />
      <Person pose="sit" activity={crew.promos > 0 ? "type" : "mug"} look={look(14)} position={[POS.growth.x - 0.4, 0, POS.growth.z + 0.92]} phase={5} />
      {[-0.45, 0.45].map((dx) => (
        <ScreenPlane key={dx} kind={crew.incident ? "alert" : "dash"} w={PANEL.w} h={PANEL.h} position={[8.2 + dx, PANEL.y, -6.9 + PANEL.z]} />
      ))}
      <Person pose="sit" activity={crew.incident ? "type" : "mug"} look={look(12)} position={[8.2, 0, -6.18]} phase={7} />
      <ScreenPlane kind="idle" w={0.52} h={0.31} position={[3.2, 1.0, 11.771]} rot={Math.PI} />
      <Person pose="sit" activity="type" look={look(18)} position={[3.2, 0, 11.3]} rotation={Math.PI} phase={2} />

      {/* A meeting in progress */}
      <ScreenPlane kind="slides" w={meetingTv.w} h={meetingTv.h} position={meetingTv.position} rot={Math.PI / 2} />
      <Person pose="stand" activity="present" look={look(36)} position={[-12.1, 0, 12.0]} rotation={-Math.PI / 2} phase={1} />
      <Person pose="sit" activity="listen" look={look(33)} position={[-10.4, 0, 11.42]} rotation={Math.PI} phase={2} />
      <Person pose="sit" activity="listen" look={look(34)} position={[-8.0, 0, 13.28]} phase={4} />
      <Person pose="sit" activity="listen" look={look(35)} position={[-9.2, 0, 13.28]} phase={6} />

      {/* Kitchen chat, the lounge, a phone call and the townhall */}
      <Person pose="stand" activity="chat" look={look(31)} position={[17.5, 0, -4.85]} rotation={0.81} phase={8} />
      <Person pose="sit" activity="listen" look={look(27)} position={[19.9, 0, 7.1]} rotation={Math.PI / 2} phase={9} />
      <Person pose="stand" activity="chat" look={look(38)} position={[-14.8, 0, 13.7]} rotation={Math.PI} phase={10} />
      <Person pose="sit" activity="laptop" look={look(40)} position={[-18.6, 0, 3.6]} rotation={-Math.PI / 2} phase={11} seat={0.87} />
      <ScreenPlane kind="slides" w={2.1} h={1.12} position={[-14.35, 1.5, 4.5]} rot={-Math.PI / 2} />
      <ScreenPlane kind="game" w={loungeTv.w} h={loungeTv.h} position={loungeTv.position} rot={Math.PI / 2} />
      {[20.4, 21.3].map((x) => (
        <ScreenPlane key={x} kind="game" w={0.54} h={0.44} position={[x, 1.25, 10.92]} tilt={-0.2} />
      ))}

      {/* People walking the corridors */}
      <Walker from={[13.2, -3.6]} to={[13.2, 12.8]} speed={0.6} look={look(21)} />
      <Walker from={[-4.4, 9.7]} to={[12.4, 9.7]} speed={0.55} look={look(16)} phase={4} />
      <Walker from={[4.4, -0.9]} to={[8.0, -0.9]} speed={0.45} look={look(23)} phase={2} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The office                                                          */
/* ------------------------------------------------------------------ */

preloadModels();

export function Office({ crew }: { crew: Crew }) {
  const prims = useMemo(() => buildStatic(), []);
  const models = useMemo(() => buildModels(), []);
  const wall = useMemo(() => buildWallMounted(), []);
  return (
    <group>
      <Floors />
      <PrimBatch prims={prims} />
      <ModelBatch placements={models} />
      <Glass />
      <WhiteboardFace position={[-12.27, 1.45, 7.4]} rot={Math.PI / 2} />
      <People crew={crew} />
      <PingPongBall />

      <OnWall wall="left">
        <PrimBatch prims={wall.leftPrims} shadows={false} />
        <ModelBatch placements={wall.left} shadows={false} />
        {FRAMES.map((f) => (
          <Poster key={f.poster} kind={f.poster} position={[FRAME_X + 0.065, f.mid, f.z]} w={f.w} h={f.h} />
        ))}
        <NeonLogo position={[ROOM.x0 + 0.08, 2.5, 4.5]} rot={Math.PI / 2} />
        <CityWindow position={[ROOM.x0 + 0.06, 1.8, -0.2]} rot={Math.PI / 2} w={1.6} h={1.5} />
        <CityWindow position={[ROOM.x0 + 0.06, 1.8, 8.9]} rot={Math.PI / 2} w={1.6} h={1.5} />
      </OnWall>
      <OnWall wall="back">
        <ModelBatch placements={wall.back} shadows={false} />
        <CityWindow position={[18.8, 2.1, ROOM.z0 + 0.08]} w={2.2} h={1.2} />
        <WallClock position={[4.2, 2.35, ROOM.z0 + 0.06]} />
        <Beacon on={crew.incident} />
      </OnWall>
      <OnWall wall="right">
        <CityWindow position={[ROOM.x1 - 0.06, 1.8, 2.0]} rot={-Math.PI / 2} w={2.2} h={1.5} />
        <CityWindow position={[ROOM.x1 - 0.06, 1.8, 7.5]} rot={-Math.PI / 2} w={2.2} h={1.5} />
      </OnWall>
    </group>
  );
}
