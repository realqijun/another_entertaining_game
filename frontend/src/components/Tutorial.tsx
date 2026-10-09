"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useGame, type TourTrack } from "@/game/store";

/**
 * Guided walkthroughs. Each step is a goal ("Add a server") plus one short
 * line saying what to click right now. The screen dims except for that one
 * thing. Nothing is blocked: the player can click elsewhere or skip.
 */

type Snapshot = ReturnType<typeof useGame.getState>;
type Place = "top" | "bottom" | "left" | "right";

interface Step {
  title: string;
  /** One short reason, if the goal needs one. */
  why?: string;
  /** What to click right now. It changes as the player moves through the step. */
  hint: (s: Snapshot) => string;
  /** CSS selector of the thing to spotlight right now. */
  target: (s: Snapshot) => string;
  /** When present, the step completes by itself once this is true. */
  done?: (s: Snapshot) => boolean;
  enter?: (s: Snapshot) => void;
  nextLabel?: string;
}

const label = (id: string) => `.eq-label[data-eq="${id}"]`;
const PRIMARY = '[data-tour="primary"]';
const clear = (s: Snapshot) => {
  s.openView(null);
  s.select(null);
};

const BASICS: Step[] = [
  {
    title: "Add a server",
    why: "A traffic surge hits in week 4.",
    hint: (s) => (s.selected === "app" ? "Press Add server." : "Click Servers, or walk there with WASD and press F."),
    target: (s) => (s.selected === "app" ? `.side ${PRIMARY}` : label("app")),
    enter: clear,
    done: (s) => s.game.infra.appHosts.length >= 2,
  },
  {
    title: "Explore Scale Up",
    why: "Larger servers handle more traffic but cost more to run.",
    hint: (s) => (s.view !== "tech" ? "Open Tech." : s.techFocus !== "larger_servers" ? "Click Scale Up." : "Press Start."),
    target: (s) =>
      s.view !== "tech" ? '.view-tabs button[data-view="tech"]' : s.techFocus !== "larger_servers" ? '.node[data-tech="larger_servers"]' : `.tree-detail ${PRIMARY}`,
    enter: (s) => s.select(null),
    done: (s) => s.game.tasks.some((t) => t.techId === "larger_servers") || s.game.releases.some((r) => r.techId === "larger_servers") || s.game.techDone.includes("larger_servers"),
  },
  {
    title: "Get more users",
    why: "Promotions bring users, and traffic.",
    hint: (s) => (s.selected === "growth" ? "Press Launch." : "Click Growth."),
    target: (s) => (s.selected === "growth" ? `.side ${PRIMARY}` : label("growth")),
    enter: clear,
    done: (s) => s.game.totals.promosRun > 0,
  },
  {
    title: "Play the week",
    hint: () => "Press Next week.",
    target: () => ".advance",
    enter: clear,
    done: (s) => s.game.turn > 1,
  },
  {
    title: "Follow this tip",
    hint: () => "It always suggests a good next move.",
    target: () => ".next-chip",
    nextLabel: "Got it",
  },
];

const INCIDENT: Step[] = [
  {
    title: "Customers are failing",
    hint: () => "The clock is paused for this guide.",
    target: () => ".incident-clock",
  },
  {
    title: "Find the cause",
    hint: () => "Click red equipment, or these.",
    target: () => ".incident-investigate",
  },
  {
    title: "Pick the matching fix",
    hint: () => "A wrong fix wastes time and money.",
    target: () => ".incident .actions",
    nextLabel: "Start",
  },
];

const TRACKS: Record<TourTrack, Step[]> = { basics: BASICS, incident: INCIDENT };
export const BASICS_STEPS = BASICS.length;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Where the card sits relative to what it points at. */
function placeFor(selector: string): Place {
  if (selector.startsWith(".eq-label") || selector.startsWith(".node")) return "right";
  if (selector.startsWith(".view-tabs") || selector.startsWith(".advance")) return "top";
  if (selector.startsWith(".next-chip")) return "bottom";
  return "left";
}

function cardStyle(box: Box | null, place: Place, vw: number, vh: number): CSSProperties {
  const W = Math.min(280, vw - 24);
  if (!box) return { left: (vw - W) / 2, top: "50%", transform: "translateY(-50%)", width: W };
  // On small screens the card docks to whichever edge is away from the target.
  if (vw < 900) {
    return box.y + box.h / 2 < vh / 2 ? { left: 12, right: 12, bottom: 12 } : { left: 12, right: 12, top: 12 };
  }
  const gap = 14;
  const x = (v: number) => clamp(v, 12, vw - W - 12);
  // Never cover the thing being pointed at: flip sides when there is no room.
  if (place === "left" && box.x - gap - W < 12) place = "right";
  else if (place === "right" && box.x + box.w + gap + W > vw - 12) place = "left";
  switch (place) {
    case "bottom":
      return { left: x(box.x), top: Math.min(box.y + box.h + gap, vh - 200), width: W };
    case "top":
      return {
        left: x(box.x + box.w / 2 < vw / 2 ? box.x : box.x + box.w - W),
        top: Math.max(12, box.y - gap),
        transform: "translateY(-100%)",
        width: W,
      };
    case "left":
      return { left: Math.max(12, box.x - gap - W), top: clamp(box.y - 10, 12, vh - 220), width: W };
    case "right":
      return { left: x(box.x + box.w + gap), top: clamp(box.y, 12, vh - 220), width: W };
  }
}

export default function Tutorial() {
  const s = useGame();
  const { tour } = s;
  const [box, setBox] = useState<Box | null>(null);
  const [selector, setSelector] = useState("");
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  const card = useRef<HTMLDivElement>(null);

  const steps = tour ? TRACKS[tour.track] : [];
  const step = tour ? steps[tour.step] : undefined;
  const track = tour?.track;
  const index = tour?.step ?? -1;
  const phaseFits = track === "basics" ? s.game.phase === "management" : s.game.phase === "incident";
  const visible = !!step && phaseFits && !s.onboarding && s.view !== "menu";

  const advance = () => {
    const now = useGame.getState();
    if (!now.tour) return;
    if (now.tour.step >= TRACKS[now.tour.track].length - 1) now.endTour(true);
    else now.tourNext();
  };

  // Run a step's setup once, then move focus to the card for keyboard and screen-reader users.
  useEffect(() => {
    if (!step) return;
    step.enter?.(useGame.getState());
    card.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, index]);

  // Steps that wait for an action finish as soon as the player has done it.
  useEffect(() => {
    if (step?.done && visible && step.done(useGame.getState())) advance();
  });

  // Follow the spotlighted element as the layout, camera or panel contents change.
  useEffect(() => {
    if (!step) return;
    let last = "";
    let scrolledFor = "";
    const read = () => {
      setViewport((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      const sel = step.target(useGame.getState());
      setSelector(sel);
      const el = document.querySelector(sel);
      if (!el) {
        if (last !== "none") {
          last = "none";
          setBox(null);
        }
        return;
      }
      if (scrolledFor !== sel) {
        scrolledFor = sel;
        if (el.closest(".side, .sheet-body, .tree-scroll, .tree-detail")) el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      const r = el.getBoundingClientRect();
      // Equipment labels sit above their racks, so the spotlight reaches down to include them.
      const k = window.innerWidth < 900 ? 0.45 : 1;
      const [pt, pr, pb, pl] = sel.startsWith(".eq-label") ? [10 * k, 46 * k, 120 * k, 46 * k] : [5, 5, 5, 5];
      const x = Math.max(4, r.left - pl);
      const y = Math.max(4, r.top - pt);
      const next = {
        x,
        y,
        w: Math.min(window.innerWidth - 4, r.right + pr) - x,
        h: Math.min(window.innerHeight - 4, r.bottom + pb) - y,
      };
      const key = `${Math.round(next.x)},${Math.round(next.y)},${Math.round(next.w)},${Math.round(next.h)}`;
      if (key !== last) {
        last = key;
        setBox(next);
      }
    };
    read();
    const id = window.setInterval(read, 120);
    window.addEventListener("resize", read);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, index]);

  if (!visible || !step || !tour) return null;

  const waiting = !!step.done;
  const name = tour.track === "basics" ? "Tutorial" : "Incident guide";
  return (
    <div className="tour" data-track={tour.track}>
      {box ? <div className="tour-hole" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} /> : <div className="tour-dim" />}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-label={`${name}, step ${tour.step + 1} of ${steps.length}`}
        tabIndex={-1}
        style={cardStyle(box, placeFor(selector), viewport.w, viewport.h)}
      >
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <i key={i} className={i < tour.step ? "is-done" : i === tour.step ? "is-now" : ""} />
          ))}
        </div>
        <h3>{step.title}</h3>
        {step.why && <p className="muted">{step.why}</p>}
        <p className="tour-prompt">{step.hint(s)}</p>
        <div className="tour-foot">
          <button type="button" className="tour-skip" onClick={() => s.endTour(false)}>
            Skip
          </button>
          {!waiting && (
            <button type="button" className="btn btn-primary btn-small" onClick={advance}>
              {step.nextLabel ?? "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
