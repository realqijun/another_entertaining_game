"use client";

import { Line, MapControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import {
  EQUIPMENT_ORDER,
  equipmentInfo,
  has,
  metrics,
  monitoringLevel,
  symptomaticEquipment,
  type EquipmentId,
  type EquipmentState,
  type GameState,
} from "@/sim";
import { useGame } from "@/game/store";
import { body, usePlayer } from "@/game/player";
import {
  AISLE_Z,
  appSlot,
  DB_CABINET,
  dbSlot,
  footprint,
  MAX_TEMP_SHOWN,
  POS,
  RACK,
  ROOM,
  tempSlot,
  type Footprint,
} from "./layout";
import { concreteFloor, LED_COLORS, panelTextures, screenTexture, type Led, type PanelVariant, type ScreenKind } from "./textures";
import { EQUIPMENT_ICON, Icon, STATE_META } from "../icons";
import { Office } from "./Office";
import Player from "./Player";
import { OnWall, updateWalls, Wall } from "./walls";

/* ------------------------------------------------------------------ */
/* Scene model: the few facts the 3D view needs, as a stable snapshot  */
/* ------------------------------------------------------------------ */

interface SceneModel {
  incident: boolean;
  hosts: Led[];
  temp: number;
  lb: boolean;
  standby: boolean;
  cache: boolean;
  dbCabinets: number;
  dbLed: Led;
  replica: boolean;
  backup: boolean;
  monitoring: 0 | 1 | 2;
  engineers: number;
  busy: number;
  releases: number;
  promos: number;
  flow: number;
  states: Record<EquipmentId, EquipmentState>;
  names: Record<EquipmentId, string>;
  built: Record<EquipmentId, boolean>;
  footprints: Record<EquipmentId, Footprint>;
  symptomatic: EquipmentId[];
  inspected: EquipmentId[];
  inspecting: EquipmentId | null;
}

function buildModel(s: GameState): SceneModel {
  const inc = s.phase === "incident" ? s.incident : null;
  const inspected = inc ? inc.evidence.map((e) => e.equipment) : [];
  const named = has(s, "monitoring") || has(s, "health_checks");
  // During an incident the racks only show what the player has actually looked at.
  const reveal = (id: EquipmentId) => !inc || inspected.includes(id);
  const m = metrics(s);

  const hosts: Led[] = s.infra.appHosts.map((h) => {
    if (h.status === "failed") return reveal("app") ? "off" : "ok";
    if (h.status === "degraded") return named ? "warn" : "ok";
    if (!inc && m.appUtil >= 1) return "critical";
    if (!inc && m.appUtil >= 0.85 && named) return "warn";
    return "ok";
  });
  const dbStatus = s.infra.dbHost.status;
  const dbLed: Led =
    dbStatus === "failed"
      ? reveal("db")
        ? "off"
        : "ok"
      : dbStatus === "degraded" && named
        ? "warn"
        : !inc && m.dbUtil >= 1
          ? "critical"
          : !inc && m.dbUtil >= 0.85 && named
            ? "warn"
            : "ok";

  const states = {} as SceneModel["states"];
  const names = {} as SceneModel["names"];
  const built = {} as SceneModel["built"];
  const footprints = {} as SceneModel["footprints"];
  for (const id of EQUIPMENT_ORDER) {
    const info = equipmentInfo(s, id);
    states[id] = info.state;
    names[id] = info.name;
    built[id] = info.built;
    footprints[id] = footprint(s, id);
  }

  return {
    incident: !!inc,
    hosts,
    temp: Math.min(inc ? (s.pendingTurn?.autoscaled ?? 0) : s.live.tempServers, MAX_TEMP_SHOWN),
    lb: has(s, "load_balancing"),
    standby: has(s, "standby"),
    cache: has(s, "caching"),
    dbCabinets: s.infra.dbTier + 1,
    dbLed,
    replica: has(s, "replicas"),
    backup: has(s, "backups"),
    monitoring: monitoringLevel(s),
    engineers: s.engineers,
    busy: s.tasks.reduce((n, t) => n + t.assigned, 0),
    releases: s.releases.length,
    promos: s.activePromos.length,
    flow: Math.round(Math.min(1.4, Math.max(m.appUtil, 0.25)) * 10) / 10,
    states,
    names,
    built,
    footprints,
    symptomatic: inc ? symptomaticEquipment(s) : [],
    inspected,
    inspecting: inc?.inspecting?.equipment ?? null,
  };
}

function useSceneModel(): SceneModel {
  const key = useGame((s) => JSON.stringify(buildModel(s.game)));
  return useMemo(() => JSON.parse(key) as SceneModel, [key]);
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

const TARGET = new THREE.Vector3(-1, 0, 0.6);
const CAMERA_OFFSET = new THREE.Vector3(20, 18, 20);
const HOME = CAMERA_OFFSET.clone().normalize();
const UP = new THREE.Vector3(0, 1, 0);
/** Tilt limits, measured from straight down: nearly top-down to a low three-quarter view. */
const MIN_TILT = 0.22;
const MAX_TILT = 1.2;
/** Q, E and the rotate buttons turn the room by an eighth of a circle. */
export const TURN = Math.PI / 4;

export const cameraApi: { zoomBy: (factor: number) => void; reset: () => void; rotateBy: (radians: number) => void } = {
  zoomBy: () => {},
  reset: () => {},
  rotateBy: () => {},
};

/** Zoom and floor point that fit the box on screen when looking along `dir`. */
function frameBox(box: THREE.Box3, dir: THREE.Vector3, width: number, height: number): { zoom: number; target: THREE.Vector3 } {
  const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  const center = box.getCenter(new THREE.Vector3());
  const p = new THREE.Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        p.set(x, y, z).sub(center);
        minX = Math.min(minX, p.dot(right));
        maxX = Math.max(maxX, p.dot(right));
        minY = Math.min(minY, p.dot(up));
        maxY = Math.max(maxY, p.dot(up));
      }
    }
  }
  // Leave room around the edges for labels, the prompt and the controls.
  const zoom = THREE.MathUtils.clamp(Math.min(width / (maxX - minX + 7), height / (maxY - minY + 6.5)), 10, 64);
  // Slide the centre down the view direction onto the floor, which is the plane the controls pan across.
  return { zoom, target: center.add(dir.clone().multiplyScalar(-center.y / dir.y)) };
}

function CameraRig({ footprints, built }: { footprints: Record<EquipmentId, Footprint>; built: Record<EquipmentId, boolean> }) {
  const controls = useRef<MapControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  /** The player has panned, zoomed or dragged the view, so it no longer follows the facility. */
  const touched = useRef(false);
  /** Turning back to the starting angle after Reset view. */
  const homing = useRef(false);
  /** Turn still to apply from Q, E or the rotate buttons. */
  const spin = useRef(0);
  const box = useRef<THREE.Box3 | null>(null);
  const v = useMemo(() => ({ offset: new THREE.Vector3(), dir: new THREE.Vector3(), before: new THREE.Vector3() }), []);

  // Frame the equipment that is actually built, and widen the view as the facility grows.
  useEffect(() => {
    const b = new THREE.Box3();
    for (const id of EQUIPMENT_ORDER) {
      if (!built[id]) continue;
      const f = footprints[id];
      b.expandByPoint(new THREE.Vector3(f.x - f.w / 2, 0, f.z - f.d / 2));
      b.expandByPoint(new THREE.Vector3(f.x + f.w / 2, f.h, f.z + f.d / 2));
    }
    box.current = b.isEmpty() ? null : b;
  }, [footprints, built]);

  useEffect(() => {
    cameraApi.zoomBy = (factor) => {
      touched.current = true;
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 10, 140);
      camera.updateProjectionMatrix();
      controls.current?.update();
    };
    cameraApi.reset = () => {
      touched.current = false;
      homing.current = true;
      spin.current = 0;
    };
    cameraApi.rotateBy = (radians) => {
      homing.current = false;
      spin.current += radians;
    };
  }, [camera]);

  // Q and E turn the room. Ignored while typing and before a run starts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !useGame.getState().started) return;
      if (e.key === "q" || e.key === "Q") cameraApi.rotateBy(-TURN);
      else if (e.key === "e" || e.key === "E") cameraApi.rotateBy(TURN);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const { offset, dir, before } = v;
    offset.copy(camera.position).sub(c.target);
    const distance = offset.length();
    let turned = false;
    if (Math.abs(spin.current) > 1e-4) {
      const step = Math.abs(spin.current) < 0.004 ? spin.current : spin.current * 0.16;
      offset.applyAxisAngle(UP, step);
      spin.current -= step;
      turned = true;
    }
    if (homing.current) {
      offset.normalize().lerp(HOME, 0.14).normalize();
      if (offset.distanceTo(HOME) < 0.002) {
        offset.copy(HOME);
        homing.current = false;
      }
      offset.multiplyScalar(distance);
      turned = true;
    }
    if (turned) camera.position.copy(c.target).add(offset);

    // Until the player takes the camera, ease toward a framing of the built equipment from the current angle.
    if (!touched.current && box.current) {
      dir.copy(offset).normalize().negate();
      const want = frameBox(box.current, dir, size.width, size.height);
      const k = 0.1;
      camera.zoom += (want.zoom - camera.zoom) * k;
      before.copy(c.target);
      c.target.lerp(want.target, k);
      camera.position.add(c.target).sub(before);
      camera.updateProjectionMatrix();
    }
    // Keep the view over the building while panning.
    const t = c.target;
    const cx = THREE.MathUtils.clamp(t.x, ROOM.x0, ROOM.x1);
    const cz = THREE.MathUtils.clamp(t.z, ROOM.z0, ROOM.z1);
    if (cx !== t.x || cz !== t.z) {
      camera.position.x += cx - t.x;
      camera.position.z += cz - t.z;
      t.x = cx;
      t.z = cz;
    }
    // Lower whichever walls now stand between the camera and the room.
    updateWalls(dir.copy(c.target).sub(camera.position).normalize());
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.14}
      zoomToCursor
      zoomSpeed={1.1}
      minZoom={10}
      maxZoom={140}
      rotateSpeed={0.7}
      minPolarAngle={MIN_TILT}
      maxPolarAngle={MAX_TILT}
      target={TARGET}
      onStart={() => {
        touched.current = true;
        homing.current = false;
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

/* A toy server room at night: flat indigo cabinets, warm desks and bright status lights. */
const STEEL = "#34305c";
const TRIM = "#2a2450";
const BEZEL = "#1d1834";

function Rack({
  x,
  z,
  led,
  variant = "server",
  size = RACK,
  tint = STEEL,
}: {
  x: number;
  z: number;
  led: Led;
  variant?: PanelVariant;
  size?: { w: number; d: number; h: number };
  tint?: string;
}) {
  const tex = useMemo(() => panelTextures(variant, led), [variant, led]);
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow receiveShadow position={[0, size.h / 2, 0]}>
        <boxGeometry args={[size.w, size.h, size.d]} />
        <meshStandardMaterial color={tint} metalness={0.1} roughness={0.8} />
      </mesh>
      <mesh position={[0, size.h / 2, size.d / 2 + 0.006]}>
        <planeGeometry args={[size.w * 0.87, size.h * 0.93]} />
        <meshStandardMaterial
          map={tex.map}
          emissiveMap={tex.emissive}
          emissive="#ffffff"
          emissiveIntensity={1.7}
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>
      {/* Side vent panel, visible from the camera's side of the rack. */}
      <mesh position={[size.w / 2 + 0.004, size.h / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[size.d * 0.8, size.h * 0.86]} />
        <meshStandardMaterial color={TRIM} metalness={0.05} roughness={0.85} />
      </mesh>
      <mesh position={[0, size.h + 0.025, size.d / 2 - 0.09]}>
        <boxGeometry args={[size.w * 0.72, 0.05, 0.07]} />
        <meshStandardMaterial
          color={LED_COLORS[led]}
          emissive={LED_COLORS[led]}
          emissiveIntensity={led === "off" ? 0 : 1.5}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function Screen({ kind, w, h, position, rotation }: { kind: ScreenKind; w: number; h: number; position: [number, number, number]; rotation?: [number, number, number] }) {
  const map = useMemo(() => screenTexture(kind), [kind]);
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[w + 0.07, h + 0.07, 0.045]} />
        <meshStandardMaterial color={BEZEL} metalness={0.05} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={map} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Cabling with moving traffic                                         */
/* ------------------------------------------------------------------ */

type P2 = [number, number];

function Cable({ points, speed, alert }: { points: P2[]; speed: number; alert: boolean }) {
  const packets = useRef<THREE.InstancedMesh>(null);
  const segments = useMemo(() => {
    const out: { a: P2; b: P2; len: number; start: number }[] = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      out.push({ a, b, len, start: total });
      total += len;
    }
    return { list: out, total };
  }, [points]);
  const count = Math.max(1, Math.round(segments.total / 2.4));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = alert ? "#ff4d5e" : "#4cb8ff";

  useFrame(({ clock }) => {
    const mesh = packets.current;
    if (!mesh || segments.total <= 0) return;
    const t = clock.elapsedTime * (0.9 + speed * 2.2);
    for (let i = 0; i < count; i++) {
      const d = (t + (i * segments.total) / count) % segments.total;
      const seg = segments.list.find((s) => d >= s.start && d <= s.start + s.len) ?? segments.list[0];
      const f = (d - seg.start) / seg.len;
      dummy.position.set(seg.a[0] + (seg.b[0] - seg.a[0]) * f, 0.075, seg.a[1] + (seg.b[1] - seg.a[1]) * f);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {segments.list.map((s, i) => {
        const horizontal = Math.abs(s.b[0] - s.a[0]) > Math.abs(s.b[1] - s.a[1]);
        return (
          <mesh key={i} receiveShadow position={[(s.a[0] + s.b[0]) / 2, 0.025, (s.a[1] + s.b[1]) / 2]}>
            <boxGeometry args={horizontal ? [s.len + 0.2, 0.05, 0.2] : [0.2, 0.05, s.len + 0.2]} />
            <meshStandardMaterial color={alert ? "#4a1630" : TRIM} emissive={color} emissiveIntensity={alert ? 0.45 : 0.1} roughness={0.8} />
          </mesh>
        );
      })}
      <instancedMesh ref={packets} args={[undefined, undefined, count]} key={count}>
        <boxGeometry args={[0.13, 0.05, 0.13]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Floor markings, hit areas and labels for each piece of equipment    */
/* ------------------------------------------------------------------ */

const ACCENT = "#4cb8ff";
const ALERT = "#ff4d5e";
const AMBER = "#ff9f1a";

function Pad({ id, f, built, symptomatic, inspecting }: { id: EquipmentId; f: Footprint; built: boolean; symptomatic: boolean; inspecting: boolean }) {
  const selected = useGame((s) => s.selected === id);
  const pointed = useGame((s) => s.hovered === id);
  // Equipment within the engineer's reach lights up as if hovered.
  const near = usePlayer((s) => s.nearby === id);
  const hovered = pointed || near;
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const alerting = symptomatic || inspecting;

  useFrame(({ clock }) => {
    if (!fill.current) return;
    const base = alerting ? 0.16 : selected ? 0.13 : hovered ? 0.07 : 0;
    fill.current.opacity = alerting ? base + 0.1 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4.2)) : base;
  });

  const color = inspecting ? AMBER : symptomatic ? ALERT : selected || hovered ? ACCENT : built ? "#8f87c9" : "#6e67a3";
  const hw = f.w / 2;
  const hd = f.d / 2;
  const outline: [number, number, number][] = [
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, 0, hd],
    [-hw, 0, hd],
    [-hw, 0, -hd],
  ];

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    useGame.getState().hover(id);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    if (useGame.getState().hovered === id) useGame.getState().hover(null);
    document.body.style.cursor = "";
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    usePlayer.getState().walkTo(id);
  };

  return (
    <group position={[f.x, 0, f.z]}>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[f.w, f.d]} />
        <meshBasicMaterial ref={fill} color={color} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <group position={[0, 0.02, 0]}>
        <Line
          points={outline}
          color={color}
          lineWidth={selected || alerting ? 2.6 : hovered ? 2.2 : 1.3}
          dashed={!built}
          dashSize={0.32}
          gapSize={0.22}
          transparent
          opacity={built || hovered || selected ? 0.95 : 0.7}
        />
      </group>
      {/* Invisible volume that catches hover and click for the whole group. */}
      <mesh position={[0, Math.max(0.4, f.h / 2), 0]} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
        <boxGeometry args={[f.w, Math.max(0.8, f.h), f.d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

/*
 * Labels are ordinary DOM buttons laid over the canvas. Each frame the scene
 * projects an anchor point above every piece of equipment to screen space and
 * moves the matching button there, so labels stay crisp and keyboard-focusable.
 */
const anchors = new Map<string, THREE.Vector3>();
const labelEls = new Map<string, HTMLElement>();
const INTERNET = "internet";
const PLAYER = "player";

function LabelProjector({ footprints }: { footprints: Record<EquipmentId, Footprint> }) {
  const v = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    for (const id of EQUIPMENT_ORDER) {
      const f = footprints[id];
      anchors.set(id, new THREE.Vector3(f.x, f.h + 0.3, f.z));
    }
    anchors.set(INTERNET, new THREE.Vector3(ROOM.x0 + 0.2, 1.35, AISLE_Z));
  }, [footprints]);

  useFrame(({ camera, size }) => {
    // The use prompt floats above the engineer's head.
    const head = anchors.get(PLAYER) ?? anchors.set(PLAYER, new THREE.Vector3()).get(PLAYER)!;
    head.set(body.x, 2.05, body.z);
    anchors.forEach((pos, key) => {
      const el = labelEls.get(key);
      if (!el) return;
      v.copy(pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.visibility = "visible";
    });
  });
  return null;
}

function bindLabel(key: string) {
  return (el: HTMLElement | null) => {
    if (el) labelEls.set(key, el);
    else labelEls.delete(key);
  };
}

function Label({ id, m }: { id: EquipmentId; m: SceneModel }) {
  const selected = useGame((s) => s.selected === id);
  const hovered = useGame((s) => s.hovered === id);
  const near = usePlayer((s) => s.nearby === id);
  const built = m.built[id];
  const inspecting = m.inspecting === id;
  const inspected = m.inspected.includes(id);
  const tone = inspecting ? "busy" : m.symptomatic.includes(id) ? "alert" : !built ? "absent" : m.states[id];
  return (
    <button
      type="button"
      ref={bindLabel(id)}
      data-eq={id}
      className={`eq-label tone-${tone}${selected ? " is-selected" : ""}${near ? " is-near" : ""}${!built && !selected && !hovered && !near ? " is-quiet" : ""}`}
      onClick={() => usePlayer.getState().walkTo(id)}
      onFocus={() => useGame.getState().hover(id)}
      onBlur={() => useGame.getState().hover(null)}
      aria-label={`${m.names[id]}${built ? "" : ", not built"}`}
    >
      <span className="eq-icon" aria-hidden="true">
        <Icon name={EQUIPMENT_ICON[id]} />
      </span>
      <span>{m.names[id]}</span>
      {!built && <span className="eq-note">not built</span>}
      {inspecting && <span className="eq-note">investigating</span>}
      {inspected && !inspecting && <span className="eq-note">checked</span>}
    </button>
  );
}

/** "F · Inspect Servers" above the engineer while something is within reach. */
function UsePrompt({ m }: { m: SceneModel }) {
  const nearby = usePlayer((s) => s.nearby);
  if (!nearby) return null;
  const verb = m.incident && m.built[nearby] && !m.inspected.includes(nearby) && m.inspecting !== nearby ? "Investigate" : "Inspect";
  return (
    <span className="use-prompt" ref={bindLabel(PLAYER)} aria-hidden="true">
      <kbd>F</kbd>
      {verb} {m.names[nearby]}
    </span>
  );
}

function Labels() {
  const m = useSceneModel();
  return (
    <div className="eq-labels">
      <span className="wall-tag" ref={bindLabel(INTERNET)}>
        <Icon name="network" />
        Internet
      </span>
      {EQUIPMENT_ORDER.filter((id) => (id !== "replica" && id !== "backup") || m.built[id]).map((id) => (
        <Label key={id} id={id} m={m} />
      ))}
      <UsePrompt m={m} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The room                                                            */
/* ------------------------------------------------------------------ */

function Room() {
  const tiles = useMemo(() => {
    const t = concreteFloor();
    t.repeat.set(ROOM.w / 1.6, ROOM.d / 1.6);
    return t;
  }, []);
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[ROOM.cx, 0, ROOM.cz]}>
        <planeGeometry args={[ROOM.w, ROOM.d]} />
        <meshLambertMaterial map={tiles} />
      </mesh>
      <mesh position={[ROOM.cx, -0.26, ROOM.cz]}>
        <boxGeometry args={[ROOM.w + 0.5, 0.5, ROOM.d + 0.5]} />
        <meshStandardMaterial color="#2a2450" roughness={0.9} />
      </mesh>
      {/* Four walls; the ones between the camera and the room drop to a low rim. */}
      <Wall wall="back" x={ROOM.cx} z={ROOM.z0 - 0.12} size={[ROOM.w + 0.5, ROOM.wallH, 0.24]} color="#5d5399" />
      <Wall wall="front" x={ROOM.cx} z={ROOM.z1 + 0.12} size={[ROOM.w + 0.5, ROOM.wallH, 0.24]} color="#5d5399" />
      <Wall wall="left" x={ROOM.x0 - 0.12} z={ROOM.cz} size={[0.24, ROOM.wallH, ROOM.d]} color="#4f4688" />
      <Wall wall="right" x={ROOM.x1 + 0.12} z={ROOM.cz} size={[0.24, ROOM.wallH, ROOM.d]} color="#4f4688" />
      <mesh position={[ROOM.cx, 0.12, ROOM.z0 + 0.02]}>
        <boxGeometry args={[ROOM.w, 0.24, 0.04]} />
        <meshStandardMaterial color={TRIM} roughness={0.85} />
      </mesh>
      <mesh position={[ROOM.x0 + 0.02, 0.12, ROOM.cz]}>
        <boxGeometry args={[0.04, 0.24, ROOM.d]} />
        <meshStandardMaterial color={TRIM} roughness={0.85} />
      </mesh>
      {/* Overhead cable tray along the back wall. */}
      <OnWall wall="back">
        <mesh castShadow position={[-3, 2.75, ROOM.z0 + 0.35]}>
          <boxGeometry args={[17, 0.1, 0.5]} />
          <meshStandardMaterial color={TRIM} metalness={0.05} roughness={0.85} />
        </mesh>
      </OnWall>
      {/* Where the internet uplink enters the building. */}
      <mesh position={[ROOM.x0 + 0.1, 0.5, AISLE_Z]}>
        <boxGeometry args={[0.2, 1, 0.7]} />
        <meshStandardMaterial color={BEZEL} metalness={0.05} roughness={0.85} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function Scene() {
  const m = useSceneModel();
  const sym = (id: EquipmentId) => m.symptomatic.includes(id);

  const appCount = Math.min(m.hosts.length, 12);
  const appMaxX = appSlot(Math.min(appCount, 6) - 1).x;
  const dbLastX = dbSlot(m.dbCabinets - 1).x;
  const aisleZ = AISLE_Z;
  const dataZ = 4.65;
  const trunkX = -8.3;
  const flow = m.flow;

  const edgeAlert = sym("gateway") || sym("app");
  const dataAlert = sym("db");

  return (
    <>
      <color attach="background" args={["#1a1633"]} />
      <hemisphereLight args={["#fff0dd", "#3b3366", 1.7]} />
      <directionalLight
        position={[11, 17, 7]}
        intensity={2.3}
        color="#fff1de"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={60}
      />
      <pointLight position={[-3, 3.4, -3.5]} intensity={24} distance={13} color="#8fc3ff" />
      <pointLight position={[0, 3.4, 5]} intensity={20} distance={12} color="#ffcf94" />

      <Room />
      <Office crew={{ engineers: m.engineers, busy: m.busy, incident: m.incident, releases: m.releases, promos: m.promos }} />

      {/* Network edge */}
      <Rack x={POS.gateway.x} z={POS.gateway.z} led={m.incident && sym("gateway") && m.inspected.includes("gateway") ? "warn" : "ok"} variant="network" />
      {m.lb && <Rack x={POS.loadBalancer.x} z={POS.loadBalancer.z} led="ok" variant="cache" size={{ w: 0.95, d: 1.05, h: 1.5 }} tint="#3a3566" />}

      {/* App servers */}
      {m.hosts.slice(0, 12).map((led, i) => {
        const p = appSlot(i);
        return <Rack key={i} x={p.x} z={p.z} led={led} />;
      })}
      {Array.from({ length: m.temp }, (_, i) => {
        const p = tempSlot(i);
        return <Rack key={`t${i}`} x={p.x} z={p.z} led="temp" tint="#2f4a7a" />;
      })}
      {m.standby && <Rack x={POS.standby.x} z={POS.standby.z} led="standby" tint="#4d3f63" />}

      {/* Data tier */}
      {m.cache && <Rack x={POS.cache.x} z={POS.cache.z} led="ok" variant="cache" size={{ w: 0.95, d: 1.05, h: 1.3 }} tint="#2f3f73" />}
      {Array.from({ length: m.dbCabinets }, (_, i) => {
        const p = dbSlot(i);
        return <Rack key={`d${i}`} x={p.x} z={p.z} led={m.dbLed} variant="db" size={DB_CABINET} tint="#3f3170" />;
      })}
      {m.replica && <Rack x={POS.replica.x} z={POS.replica.z} led="ok" variant="db" size={DB_CABINET} tint="#3f3170" />}
      {m.backup && <Rack x={POS.backup.x} z={POS.backup.z} led="ok" variant="storage" size={{ w: 1.9, d: 1.05, h: 1.25 }} tint="#3b3560" />}

      {/* Monitoring wall */}
      {m.monitoring > 0 &&
        [-1.6, 0, 1.6].map((dx, i) => (
          <Screen
            key={i}
            kind={m.incident ? "alert" : i === 2 && m.monitoring === 2 ? "chart" : "dash"}
            w={1.45}
            h={0.9}
            position={[POS.monitoring.x + dx, 2.05, ROOM.z0 + 0.05]}
          />
        ))}

      {/* Cabling: internet -> edge -> app servers -> (cache) -> database -> replica / backups */}
      <Cable points={[[ROOM.x0 + 0.2, aisleZ], [POS.gateway.x, aisleZ]]} speed={flow} alert={edgeAlert} />
      <Cable points={[[POS.gateway.x, aisleZ], [Math.max(appMaxX, -6.6) + 0.4, aisleZ]]} speed={flow} alert={edgeAlert} />
      <Cable
        points={[
          [trunkX, aisleZ],
          [trunkX, dataZ],
          [dbLastX + 0.4, dataZ],
        ]}
        speed={flow * (m.cache ? 0.7 : 1)}
        alert={dataAlert}
      />
      {m.replica && <Cable points={[[dbLastX + 0.4, dataZ], [POS.replica.x + 0.3, dataZ]]} speed={0.35} alert={false} />}
      {m.backup && <Cable points={[[m.replica ? POS.replica.x + 0.3 : dbLastX + 0.4, dataZ], [POS.backup.x + 0.4, dataZ]]} speed={0.15} alert={false} />}

      {EQUIPMENT_ORDER.map((id) => (
        <Pad key={id} id={id} f={m.footprints[id]} built={m.built[id]} symptomatic={sym(id)} inspecting={m.inspecting === id} />
      ))}
      <Player footprints={m.footprints} built={m.built} />
      <LabelProjector footprints={m.footprints} />

      <CameraRig footprints={m.footprints} built={m.built} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Hover summary (name, status, one metric)                            */
/* ------------------------------------------------------------------ */

function HoverTip({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const hovered = useGame((s) => s.hovered);
  const game = useGame((s) => s.game);
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      if (!tip.current) return;
      const r = el.getBoundingClientRect();
      const x = Math.min(e.clientX - r.left + 16, r.width - 260);
      const y = Math.min(e.clientY - r.top + 18, r.height - 110);
      tip.current.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, [container]);

  const info = hovered ? equipmentInfo(game, hovered) : null;
  const incident = game.phase === "incident" && game.incident;
  let status = info ? STATE_META[info.state].word : "";
  let summary = info?.summary ?? "";
  let action = "";
  if (info && incident) {
    const checked = incident.evidence.some((e) => e.equipment === info.id);
    status = symptomaticEquipment(game).includes(info.id) ? "Showing symptoms" : info.built ? "No alert" : "Not built";
    summary = checked ? "Evidence collected" : info.built ? "Not yet investigated" : "";
    action = checked || !info.built ? "" : "Click to investigate";
  }

  return (
    <div ref={tip} className={`hover-tip${info ? " is-on" : ""}`} role="status" aria-live="off">
      {info && (
        <>
          <strong>{info.name}</strong>
          <span className={`hover-state tone-${incident ? (status === "Showing symptoms" ? "alert" : "ok") : info.state}`}>
            <Icon name={incident ? (status === "Showing symptoms" ? "alert" : "check") : STATE_META[info.state].icon} />
            {status}
          </span>
          {summary && <span className="hover-summary">{summary}</span>}
          {action && <span className="hover-action">{action}</span>}
        </>
      )}
    </div>
  );
}

/** True when WebGL is drawn on the CPU (SwiftShader, llvmpipe and similar), as on machines without a GPU. */
function isSoftwareRenderer(gl: THREE.WebGLRenderer): boolean {
  const ctx = gl.getContext();
  const info = ctx.getExtension("WEBGL_debug_renderer_info");
  const name = String(info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
  return /swiftshader|llvmpipe|software|softpipe|basic render/i.test(name);
}

/** Software rendering cannot keep up with 60 frames a second, so it draws 20. */
const SOFTWARE_FPS = 20;

/** In on-demand mode, ask for a new frame 20 times a second. */
function SoftwareFrames() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = window.setInterval(() => invalidate(), 1000 / SOFTWARE_FPS);
    return () => window.clearInterval(id);
  }, [invalidate]);
  return null;
}

export default function Facility() {
  const container = useRef<HTMLDivElement>(null);
  /** Drawing in software, without a GPU: no shadows, half the pixels, 20 frames a second. */
  const [soft, setSoft] = useState(false);
  const nearby = usePlayer((s) => s.nearby);
  return (
    <div className="stage-canvas" ref={container} data-nearby={nearby ?? ""}>
      <Canvas
        orthographic
        shadows={soft ? false : "percentage"}
        dpr={soft ? 0.5 : [1, 1.75]}
        frameloop={soft ? "demand" : "always"}
        onCreated={({ gl }) => {
          // Without a graphics card the browser draws on the CPU. Keep it playable: no shadows, half the pixels
          // (labels and the interface are HTML and stay sharp) and 20 frames a second. A GPU keeps full quality.
          if (isSoftwareRenderer(gl)) {
            // Before the first frame, so no material is ever compiled with shadows.
            gl.shadowMap.enabled = false;
            setSoft(true);
          }
        }}
        camera={{ position: [TARGET.x + CAMERA_OFFSET.x, CAMERA_OFFSET.y, TARGET.z + CAMERA_OFFSET.z], zoom: 30, near: 0.1, far: 200 }}
        onPointerMissed={() => {
          if (useGame.getState().game.phase !== "incident") useGame.getState().select(null);
        }}
        aria-label="Isometric view of the server room. Walk the engineer with WASD or the arrow keys and press F to use equipment. Each equipment label is a button that sends the engineer there."
      >
        <Scene />
        {soft && <SoftwareFrames />}
      </Canvas>
      <Labels />
      <HoverTip container={container} />
      <div className="camera-buttons" role="group" aria-label="Camera">
        <button type="button" onClick={() => cameraApi.zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <button type="button" onClick={() => cameraApi.zoomBy(0.8)} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <button type="button" onClick={() => cameraApi.rotateBy(-TURN)} aria-label="Rotate left" title="Rotate left (Q)">
          <Icon name="rotateLeft" size={16} />
        </button>
        <button type="button" onClick={() => cameraApi.rotateBy(TURN)} aria-label="Rotate right" title="Rotate right (E)">
          <Icon name="rotateRight" size={16} />
        </button>
        <button type="button" onClick={() => cameraApi.reset()} aria-label="Reset view" title="Reset view: fit the room and face the starting angle">
          ⌂
        </button>
        <span className="camera-hint" aria-hidden="true">
          <kbd>WASD</kbd> walk · <kbd>F</kbd> use · <kbd>Shift</kbd> + drag to rotate and tilt · <kbd>Q</kbd> <kbd>E</kbd> to turn
        </span>
      </div>
    </div>
  );
}
