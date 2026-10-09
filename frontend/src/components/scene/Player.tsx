"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EQUIPMENT_ORDER, type EquipmentId } from "@/sim";
import { useGame } from "@/game/store";
import { body, canMove, usePlayer } from "@/game/player";
import type { Footprint } from "./layout";
import { blockers, collide, escape, moveDirection, nearestInRange, type Held, type Rect, type Vec2 } from "./nav";
import { Person, type Look } from "./people";

const SPEED = 3.5;
/** Long frames (a slow GPU, a background tab) are walked in short steps so collisions still hold. */
const MAX_FRAME = 0.5;
const STEP = 0.05;
/** Give up on a walk that has made no progress for this long, and use the machine anyway. */
const STUCK_AFTER = 0.75;

const KEYS: Record<string, keyof Held> = {
  w: "up",
  arrowup: "up",
  s: "down",
  arrowdown: "down",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
};

const held: Held = { up: false, down: false, left: false, right: false };

function release() {
  held.up = held.down = held.left = held.right = false;
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/**
 * WASD or arrow keys to walk, F to use. Q and E belong to the camera, which
 * turns the room; Space is left alone because it presses the focused button.
 */
function usePlayerKeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      const dir = KEYS[key];
      if (!dir && key !== "f") return;
      if (!canMove(useGame.getState())) return;
      if (dir) {
        e.preventDefault();
        held[dir] = true;
        // Taking the controls cancels a walk that a click started.
        usePlayer.getState().cancelWalk();
      } else if (!e.repeat) {
        usePlayer.getState().interact();
      }
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEYS[e.key.toLowerCase()];
      if (dir) held[dir] = false;
    };
    const hidden = () => {
      if (document.visibilityState !== "visible") release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
      release();
    };
  }, []);
}

/** The engineer you play: a yellow hoodie and headphones, so they stand out from the office crowd. */
const PLAYER_LOOK: Look = {
  skin: "#d9a07a",
  hair: "#1d1834",
  hairStyle: "short",
  top: "#ffd84a",
  topStyle: "hoodie",
  accent: "#1d1834",
  pants: "#2b3150",
  shoes: "#fff7e8",
  glasses: false,
  headphones: true,
  beard: false,
  badge: true,
  height: 0.98,
  build: 1,
};

/** A soft ring on the floor under the engineer, in the same yellow as the use prompt. */
function Marker() {
  return (
    <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.32, 0.42, 32]} />
      <meshBasicMaterial color="#ffd84a" transparent opacity={0.85} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

export default function Player({ footprints, built }: { footprints: Record<EquipmentId, Footprint>; built: Record<EquipmentId, boolean> }) {
  const root = useRef<THREE.Group>(null);
  const stuck = useRef(0);
  const [walking, setWalking] = useState(false);
  const forward = useMemo(() => new THREE.Vector3(), []);
  // The scene model is rebuilt on every game change; only re-plan when the blocked floor itself changes.
  const blockKey = JSON.stringify(blockers(footprints, built));
  const blocks = useMemo(() => JSON.parse(blockKey) as Rect[], [blockKey]);
  const incident = useGame((s) => s.game.phase === "incident");

  usePlayerKeys();

  // A walk started before an incident must not investigate on its own once the incident begins.
  useEffect(() => {
    usePlayer.getState().cancelWalk();
  }, [incident]);

  // When the room changes, step out of anything just built here and re-plan a walk in progress.
  useEffect(() => {
    const out = escape(body, blocks);
    body.x = out.x;
    body.z = out.z;
    const goal = usePlayer.getState().goal;
    if (goal) usePlayer.getState().walkTo(goal.id);
  }, [blocks]);

  useEffect(() => () => usePlayer.getState().setNearby(null), []);

  useFrame(({ camera }, delta) => {
    const player = usePlayer.getState();
    let moving = false;
    // Keys move relative to the screen, so follow the camera as the player turns the room.
    camera.getWorldDirection(forward);
    const view: Vec2 = { x: forward.x, z: forward.z };
    if (canMove(useGame.getState())) {
      let left = Math.min(delta, MAX_FRAME);
      while (left > 1e-6) {
        const dt = Math.min(STEP, left);
        left -= dt;
        const dir = moveDirection(held, view);
        const goal = usePlayer.getState().goal;
        let target: { x: number; z: number } | null = null;
        if (dir) {
          target = { x: body.x + dir.x * SPEED * dt, z: body.z + dir.z * SPEED * dt };
        } else if (goal && goal.path.length > 0) {
          const wp = goal.path[0];
          const dx = wp.x - body.x;
          const dz = wp.z - body.z;
          const dist = Math.hypot(dx, dz);
          const stepLen = SPEED * dt;
          if (dist <= stepLen) {
            target = wp;
            // Waypoints are consumed in place; nothing renders from the path.
            goal.path.shift();
          } else {
            target = { x: body.x + (dx / dist) * stepLen, z: body.z + (dz / dist) * stepLen };
          }
        }
        if (!target) break;
        const next = collide(body, target, blocks);
        const dx = next.x - body.x;
        const dz = next.z - body.z;
        if (Math.hypot(dx, dz) > 1e-4) {
          body.heading = Math.atan2(dx, dz);
          stuck.current = 0;
          moving = true;
        } else if (!dir) {
          stuck.current += dt;
        }
        body.x = next.x;
        body.z = next.z;
        if (goal && !dir && (goal.path.length === 0 || stuck.current > STUCK_AFTER)) {
          stuck.current = 0;
          usePlayer.getState().arrive();
          break;
        }
      }
    }

    player.setNearby(nearestInRange(body, footprints, EQUIPMENT_ORDER));

    const g = root.current;
    if (g) {
      g.position.set(body.x, 0, body.z);
      // Turn the short way round toward the heading.
      const turn = Math.atan2(Math.sin(body.heading - g.rotation.y), Math.cos(body.heading - g.rotation.y));
      g.rotation.y += turn * Math.min(1, delta * 14);
    }
    if (moving !== walking) setWalking(moving);
  });

  return (
    <group ref={root} position={[body.x, 0, body.z]} rotation={[0, body.heading, 0]}>
      <Marker />
      {/* People face -z in their own frame; the engineer's heading points along +z. */}
      <Person pose="stand" activity={walking ? "walk" : "idle"} look={PLAYER_LOOK} position={[0, 0, 0]} rotation={Math.PI} />
    </group>
  );
}
