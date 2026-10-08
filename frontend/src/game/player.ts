"use client";

import { create } from "zustand";
import { EQUIPMENT_ORDER, equipmentInfo, type EquipmentId, type GameState } from "@/sim";
import { footprint, type Footprint } from "@/components/scene/layout";
import { approachPoints, blockers, findPath, inRange, type Rect, type Vec2 } from "@/components/scene/nav";
import { inspectOrSelect, useGame } from "./store";

/**
 * The engineer the player walks around the room. Where they stand is
 * presentation only: it is never saved and never reaches the simulation.
 * Using equipment still goes through `inspectOrSelect`, so incident rules
 * are the engine's, not the character's.
 */

/** The office walkway between the deploy console and the growth desk, out of reach of everything. */
export const SPAWN: Vec2 = { x: 2.9, z: 6.2 };

/**
 * Position and heading, mutated every frame by the scene. Kept outside
 * Zustand so that walking does not re-render React.
 */
export const body = { x: SPAWN.x, z: SPAWN.z, heading: Math.PI * 0.75 };

export interface Goal {
  id: EquipmentId;
  path: Vec2[];
}

interface PlayerStore {
  /** The equipment within reach, which the use key (F) acts on. */
  nearby: EquipmentId | null;
  goal: Goal | null;
  setNearby: (id: EquipmentId | null) => void;
  /** Walk to a piece of equipment and use it on arrival (at once if already in reach). */
  walkTo: (id: EquipmentId) => void;
  cancelWalk: () => void;
  /** Called by the scene when the last waypoint is reached. */
  arrive: () => void;
  /** Use the equipment within reach. */
  interact: () => void;
}

export interface RoomPlan {
  footprints: Record<EquipmentId, Footprint>;
  blocks: Rect[];
}

export function roomPlan(s: GameState): RoomPlan {
  const footprints = {} as Record<EquipmentId, Footprint>;
  const built = {} as Record<EquipmentId, boolean>;
  for (const id of EQUIPMENT_ORDER) {
    footprints[id] = footprint(s, id);
    built[id] = equipmentInfo(s, id).built;
  }
  return { footprints, blocks: blockers(footprints, built) };
}

/** Walking needs the room in view and, during an incident, the crisis clock running. */
export function canMove(s: ReturnType<typeof useGame.getState>): boolean {
  if (!s.started || s.view || s.onboarding || s.tour?.track === "incident") return false;
  if (s.game.phase === "incident") return s.running;
  return s.game.phase === "management";
}

export const usePlayer = create<PlayerStore>()((set, get) => ({
  nearby: null,
  goal: null,

  setNearby: (id) => {
    if (get().nearby !== id) set({ nearby: id });
  },

  walkTo: (id) => {
    const { footprints, blocks } = roomPlan(useGame.getState().game);
    const f = footprints[id];
    if (inRange(body, f)) {
      set({ goal: null });
      inspectOrSelect(id);
      return;
    }
    // The nearest standing spot can sit in a dead end (say, behind a rack against the wall).
    for (const spot of approachPoints(f, body, blocks).slice(0, 12)) {
      const path = findPath(body, spot, blocks);
      if (path) {
        set({ goal: { id, path } });
        return;
      }
    }
    // Never leave the player unable to reach a machine.
    set({ goal: null });
    inspectOrSelect(id);
  },

  cancelWalk: () => {
    if (get().goal) set({ goal: null });
  },

  arrive: () => {
    const goal = get().goal;
    if (!goal) return;
    set({ goal: null });
    inspectOrSelect(goal.id);
  },

  interact: () => {
    const id = get().nearby;
    if (!id) return;
    set({ goal: null });
    inspectOrSelect(id);
  },
}));
