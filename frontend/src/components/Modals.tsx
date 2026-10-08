"use client";

import { useEffect, useMemo, useState } from "react";
import { BALANCE, buildReport } from "@/sim";
import { money, moneyFull, num, uptimePct } from "@/game/format";
import { clearAnalytics, clearSave, readAnalytics, type AnalyticsEvent } from "@/game/persist";
import { isFreshRun, useGame } from "@/game/store";
import { Icon, type IconName } from "./icons";
import { Callout, Concept, Modal, type ConceptKind } from "./ui";
import { OUTCOME_ICON, OUTCOME_LABEL, outcomeTone, PostmortemBody, RunCharts } from "./Views";

/* ------------------------------------------------------------------ */
/* Title screen                                                        */
/* ------------------------------------------------------------------ */

/** The first thing anyone sees: the room, the name, the goal and one button. */
export function TitleScreen() {
  const game = useGame((s) => s.game);
  const meta = useGame((s) => s.meta);
  const play = useGame((s) => s.play);
  const newRun = useGame((s) => s.newRun);
  const startTutorialRun = useGame((s) => s.startTutorialRun);
  const resumable = !isFreshRun(game) && game.phase !== "ended";

  const fresh = () => (meta.tutorialDone ? newRun({}) : startTutorialRun());

  return (
    <div className="title-screen">
      <div className="title-card">
        <span className="title-kicker">
          <Icon name="server" size={16} />
          A system design tycoon
        </span>
        <h1>99.99%</h1>
        <p className="title-tag">Grow a startup. Keep it online.</p>
        <p className="title-goal">
          Reach <strong>{num(BALANCE.targetUsers)} users</strong> in <strong>{BALANCE.maxTurns} weeks</strong> without running out of cash.
        </p>
        <ul className="title-loop" aria-label="How a run works">
          <li>
            <Concept kind="users" icon="users" />
            Grow users
          </li>
          <li>
            <Concept kind="tech" icon="server" />
            Scale your stack
          </li>
          <li>
            <Concept kind="critical" icon="incident" />
            Survive incidents
          </li>
        </ul>
        <div className="title-actions">
          {resumable ? (
            <>
              <button type="button" className="btn btn-primary btn-big" autoFocus onClick={play}>
                <Icon name="play" />
                Continue week {game.turn}
              </button>
              <button type="button" className="btn btn-big" onClick={fresh}>
                New game
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-big" autoFocus onClick={game.phase === "ended" ? fresh : play}>
              <Icon name="play" />
              Play
            </button>
          )}
        </div>
        {meta.tutorialDone && (
          <button type="button" className="link-btn" onClick={startTutorialRun}>
            Replay the tutorial
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* How to play (reference card, opened from the menu)                  */
/* ------------------------------------------------------------------ */

export function HowToPlay() {
  const finish = useGame((s) => s.finishOnboarding);
  return (
    <Modal title="How to play" onClose={finish} icon={{ kind: "go", name: "info" }}>
      <ul className="howto">
        <li>
          <Concept kind="users" icon="goal" />
          <span>
            Reach {num(BALANCE.targetUsers)} users by week {BALANCE.maxTurns}. Do not run out of cash.
          </span>
        </li>
        <li>
          <Concept kind="ok" icon="server" />
          <span>Click equipment to send your engineer there, or walk with WASD and press F. Then act on it.</span>
        </li>
        <li>
          <Concept kind="tech" icon="tree" />
          <span>Tech holds upgrades. Engineers build them, then you ship them.</span>
        </li>
        <li>
          <Concept kind="go" icon="next" />
          <span>Next week moves everything forward.</span>
        </li>
        <li>
          <Concept kind="critical" icon="incident" />
          <span>In an incident, find the cause, then pick the matching fix.</span>
        </li>
        <li>
          <Concept kind="tech" icon="rotateRight" />
          <span>Drag to move and scroll to zoom. Shift + drag (or right-drag) rotates and tilts; Q and E turn the room.</span>
        </li>
        <li>
          <Concept kind="muted" icon="pause" />
          <span>P pauses. Esc closes panels.</span>
        </li>
      </ul>
      <div className="modal-foot">
        <span />
        <button type="button" className="btn btn-primary" autoFocus onClick={finish}>
          Got it
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Postmortem after an incident                                        */
/* ------------------------------------------------------------------ */

export function PostmortemModal() {
  const game = useGame((s) => s.game);
  const act = useGame((s) => s.act);
  const pm = game.postmortems.find((p) => p.id === game.reviewId) ?? game.postmortems[game.postmortems.length - 1];
  if (!pm) return null;
  return (
    <Modal title={pm.title} wide tone={pm.outcome === "failed" ? "alert" : undefined} icon={{ kind: outcomeTone(pm), name: "incident" }}>
      <p className="pm-meta">
        <span className={`tag tag-${outcomeTone(pm)}`}>
          <Icon name={OUTCOME_ICON[pm.outcome]} size={12} />
          {OUTCOME_LABEL[pm.outcome]}
        </span>
        <span className="muted">Postmortem, week {pm.turn}</span>
      </p>
      <PostmortemBody pm={pm} />
      <div className="modal-foot">
        <span />
        <button type="button" className="btn btn-primary" autoFocus onClick={() => act({ type: "acknowledge_review" })}>
          Continue
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* End of run                                                          */
/* ------------------------------------------------------------------ */

export function EndReport() {
  const game = useGame((s) => s.game);
  const newRun = useGame((s) => s.newRun);
  const rate = useGame((s) => s.rate);
  const rating = useGame((s) => s.rating);
  const openView = useGame((s) => s.openView);
  const view = useGame((s) => s.view);
  const r = useMemo(() => buildReport(game), [game]);
  if (view === "history") return null;

  return (
    <Modal title={r.headline} wide tone={r.outcome === "won" ? undefined : "alert"} icon={r.outcome === "won" ? { kind: "go", name: "goal" } : { kind: "critical", name: "flag" }}>
      <div className="report-top">
        <div className={`grade grade-${r.grade}`} aria-label={`Grade ${r.grade}`}>
          {r.grade}
        </div>
        <p className="report-summary">{r.summary}</p>
      </div>

      <dl className="stats">
        <div>
          <Concept kind="users" icon="users" />
          <dt>Users</dt>
          <dd>{num(r.users)}</dd>
        </div>
        <div>
          <Concept kind="health" icon="health" />
          <dt>Uptime</dt>
          <dd>{uptimePct(r.uptime)}</dd>
        </div>
        <div>
          <Concept kind="cash" icon="cash" />
          <dt>Cash</dt>
          <dd>{moneyFull(r.cash)}</dd>
        </div>
        <div>
          <Concept kind="critical" icon="incident" />
          <dt>Incidents</dt>
          <dd>{r.incidents.total}</dd>
        </div>
      </dl>

      <div className="callout-stack">
        {r.takeaways.slice(0, 2).map((t) => (
          <Callout key={t} tone="hint" icon="bulb" kicker="Takeaway">
            {t}
          </Callout>
        ))}
      </div>

      <div className="rating">
        <p id="rating-label">Enjoyed it?</p>
        <div className="rating-buttons" role="radiogroup" aria-labelledby="rating-label">
          {[1, 2, 3, 4, 5].map((n) => (
            <button type="button" key={n} role="radio" aria-checked={rating === n} aria-label={`${n} out of 5`} className={rating === n ? "is-on" : ""} onClick={() => rate(n)}>
              {n}
            </button>
          ))}
        </div>
        <span className="muted">{rating ? "Thanks!" : "1 no, 5 loved it"}</span>
      </div>

      <details className="more">
        <summary>Details</summary>
        <dl className="rows">
          <div className="row">
            <dt>Score</dt>
            <dd>{r.score} / 100</dd>
          </div>
          <div className="row">
            <dt>Incidents</dt>
            <dd>
              {r.incidents.resolved} fixed, {r.incidents.mitigated} contained, {r.incidents.failed} failed, {r.incidents.automatic} automatic
            </dd>
          </div>
          <div className="row">
            <dt>Upgrades live</dt>
            <dd>
              {r.techCount} of {r.techTotal}
            </dd>
          </div>
          <div className="row">
            <dt>Deploys</dt>
            <dd>
              {r.releasesTested} tested, {r.releasesUntested} untested
            </dd>
          </div>
          <div className="row">
            <dt>Seed</dt>
            <dd>{r.seed}</dd>
          </div>
        </dl>
        <RunCharts game={game} compactSet />
      </details>

      <div className="modal-foot">
        <button type="button" className="btn btn-quiet" onClick={() => openView("history")}>
          <Icon name="history" size={16} />
          History
        </button>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => newRun({ seed: game.seed, voluntary: true })}>
            <Icon name="refresh" size={16} />
            Same seed
          </button>
          <button type="button" className="btn btn-primary" autoFocus onClick={() => newRun({ voluntary: true })}>
            <Icon name="play" size={16} />
            Play again
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Menu: save, new game, prototype data                                */
/* ------------------------------------------------------------------ */

function summarise(events: AnalyticsEvent[]) {
  const count = (name: string) => events.filter((e) => e.name === name).length;
  const ratings = events.filter((e) => e.name === "rating_submitted").map((e) => Number(e.data?.rating ?? 0));
  return [
    ["Runs started", count("run_started")],
    ["Runs finished", count("run_finished")],
    ["Tutorial finished", count("tutorial_completed") > 0 ? "yes" : "no"],
    ["First incident started", count("first_incident_started") > 0 ? "yes" : "no"],
    ["First incident completed", count("first_incident_completed") > 0 ? "yes" : "no"],
    ["Incidents handled", count("incident_completed")],
    ["Hints used", count("hint_used")],
    ["Voluntary replays", count("voluntary_replay")],
    ["Average rating", ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : "none"],
  ] as [string, string | number][];
}

/** A big, labelled menu choice: what it is, and one line on what it does. */
function MenuTile({ icon, kind, title, text, onClick, danger = false }: { icon: IconName; kind: ConceptKind; title: string; text: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={`menu-tile${danger ? " is-danger" : ""}`} onClick={onClick} aria-label={title}>
      <Concept kind={danger ? "critical" : kind} icon={danger ? "alert" : icon} />
      <span className="menu-tile-body">
        <strong>{title}</strong>
        <span>{danger ? "Your current run will be replaced." : text}</span>
      </span>
    </button>
  );
}

export function Menu() {
  const game = useGame((s) => s.game);
  const openView = useGame((s) => s.openView);
  const saveNow = useGame((s) => s.saveNow);
  const newRun = useGame((s) => s.newRun);
  const showOnboarding = useGame((s) => s.showOnboarding);
  const startTutorialRun = useGame((s) => s.startTutorialRun);
  const notify = useGame((s) => s.notify);
  const [seed, setSeed] = useState("");
  const [confirm, setConfirm] = useState<"new" | "reset" | "tutorial" | null>(null);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);

  useEffect(() => setEvents(readAnalytics()), []);

  const inProgress = !game.outcome && game.totals.weeks > 0;
  const start = (kind: "new" | "reset" | "tutorial") => {
    if (inProgress && confirm !== kind) {
      setConfirm(kind);
      return;
    }
    if (kind === "tutorial") {
      startTutorialRun();
    } else if (kind === "reset") {
      clearSave();
      newRun({ seed: BALANCE.introSeed });
    } else {
      newRun({ seed: seed.trim() });
    }
  };
  const label = (kind: "new" | "reset" | "tutorial", text: string) => (confirm === kind ? "Lose this run? Press again" : text);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(events, null, 2));
      notify("Copied", "success");
    } catch {
      notify("Could not reach the clipboard.", "error");
    }
  };

  const close = () => openView(null);
  const week = Math.min(game.turn, BALANCE.maxTurns);

  return (
    <Modal title="Menu" onClose={close} icon={{ kind: "go", name: "menu" }} wide>
      <section className="menu-run" aria-label="This run">
        <div className="menu-run-head">
          <span className="menu-run-title">This run</span>
          <span className="tag tag-ok">
            <Icon name="save" size={12} />
            Autosaved
          </span>
        </div>
        <dl className="menu-run-stats">
          <div>
            <Concept kind="go" icon="week" />
            <dt>Week</dt>
            <dd>
              {week} / {BALANCE.maxTurns}
            </dd>
          </div>
          <div>
            <Concept kind="users" icon="users" />
            <dt>Users</dt>
            <dd>{num(game.users)}</dd>
          </div>
          <div>
            <Concept kind="cash" icon="cash" />
            <dt>Cash</dt>
            <dd>{money(game.cash)}</dd>
          </div>
        </dl>
        <p className="menu-seed">
          Seed <code>{game.seed}</code> Playing the same seed again gives the same run.
        </p>
      </section>

      <button type="button" className="btn btn-primary btn-big menu-resume" autoFocus onClick={close}>
        <Icon name="play" />
        Resume
      </button>

      <div className="menu-grid">
        <MenuTile icon="save" kind="ok" title="Save now" text="Write this run to the browser." onClick={saveNow} />
        <MenuTile icon="info" kind="users" title="How to play" text="The rules on one card." onClick={showOnboarding} />
        <MenuTile icon="robot" kind="go" title={label("tutorial", "Tutorial")} text="Replay the guided first week." danger={confirm === "tutorial"} onClick={() => start("tutorial")} />
      </div>

      <section className="menu-section" aria-label="Start over">
        <h4>
          <Icon name="refresh" size={16} />
          Start over
        </h4>
        <label className="field">
          <span>Seed (optional): leave empty for a random run.</span>
          <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Random" inputMode="text" maxLength={24} />
        </label>
        <div className="btn-row">
          <button type="button" className={`btn ${confirm === "new" ? "btn-danger" : "btn-primary"}`} onClick={() => start("new")}>
            {label("new", "New game")}
          </button>
          <button type="button" className={`btn ${confirm === "reset" ? "btn-danger" : ""}`} onClick={() => start("reset")}>
            {label("reset", "Reset to first run")}
          </button>
        </div>
        {confirm && (
          <Callout compact tone="warn" icon="alert" kicker="Are you sure?">
            This replaces your week {week} run. Press the red button again to confirm.
          </Callout>
        )}
      </section>

      <details className="more">
        <summary>Playtest data ({events.length} events)</summary>
        <p className="muted">Kept in this browser only.</p>
        <dl className="rows">
          {summarise(events).map(([k, v]) => (
            <div className="row" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="btn-row">
          <button type="button" className="btn" onClick={copy} disabled={events.length === 0}>
            Copy as JSON
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={events.length === 0}
            onClick={() => {
              clearAnalytics();
              setEvents([]);
            }}
          >
            Clear
          </button>
        </div>
      </details>
    </Modal>
  );
}
