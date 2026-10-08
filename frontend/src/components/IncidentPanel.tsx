"use client";

import { equipmentInfo, inspectable, inspectSeconds, recoveryOptions, symptomaticEquipment } from "@/sim";
import { clock, moneyFull, num, pct } from "@/game/format";
import { inspectOrSelect, useGame } from "@/game/store";
import { EQUIPMENT_ICON, Icon, type IconName } from "./icons";
import { Callout, Concept, Meter, Tip, type CalloutTone } from "./ui";

const ATTEMPT: Record<string, { tone: CalloutTone; icon: IconName; word: string }> = {
  fixed: { tone: "success", icon: "check", word: "Fixed" },
  mitigated: { tone: "warn", icon: "alert", word: "Contained" },
  partial: { tone: "warn", icon: "alert", word: "Helped a little" },
  no_effect: { tone: "critical", icon: "close", word: "No effect" },
};

/**
 * The crisis workspace. The alert shows symptoms only; the player investigates
 * equipment to find the cause and then picks a fix. Explanations sit in
 * tooltips so the panel itself stays short enough to read under pressure.
 */
export default function IncidentPanel() {
  const game = useGame((s) => s.game);
  const running = useGame((s) => s.running);
  const setRunning = useGame((s) => s.setRunning);
  const act = useGame((s) => s.act);
  const inc = game.incident;
  if (!inc) return null;

  // List the options as they stand without the "busy" lock, so the list does not jump while a fix runs.
  const options = recoveryOptions({ ...game, incident: { ...inc, pending: null } });
  const usable = options.filter((o) => o.enabled);
  const blocked = options.filter((o) => !o.enabled);
  const places = inspectable(game);
  const symptomatic = symptomaticEquipment(game);
  const lookSeconds = inspectSeconds(game);
  const timeLeft = Math.max(0, inc.maxDuration - inc.elapsed);
  const pending = inc.pending;

  return (
    <section className="panel-section incident" aria-label="Incident">
      <header className="panel-head">
        <span className="panel-icon state-critical">
          <Icon name="incident" />
        </span>
        <div>
          <h2>{inc.title}</h2>
          <span className="state state-critical">
            <Icon name="alert" size={12} />
            Incident
          </span>
        </div>
      </header>

      <div className="incident-clock">
        <div className="clock-row">
          <Icon name="alarm" />
          <Tip text="One second here is one minute of outage. Customers leave while it runs. After 2:00 it is out of your hands.">
            <strong className="clock-time">{clock(inc.elapsed)}</strong>
          </Tip>
          <span className="muted">/ {clock(inc.maxDuration)}</span>
          <button type="button" className="btn btn-small" onClick={() => setRunning(!running)}>
            <Icon name={running ? "pause" : "play"} size={16} />
            {running ? "Pause" : "Resume"}
          </button>
        </div>
        <Meter value={inc.elapsed / inc.maxDuration} tone={timeLeft < 30 ? "critical" : "warn"} label="Incident time used" />
      </div>

      <div className="incident-symptoms">
        <dl className="impact">
          <div>
            <Concept kind="critical" icon="fire" />
            <dt>Failing</dt>
            <dd className="text-critical">{pct(inc.severity)}</dd>
          </div>
          <div>
            <Concept kind="users" icon="users" />
            <dt>Users lost</dt>
            <dd>{num(inc.damage.usersLost)}</dd>
          </div>
          <div>
            <Concept kind="cash" icon="cash" />
            <dt>Spent</dt>
            <dd>{moneyFull(inc.damage.moneySpent)}</dd>
          </div>
        </dl>
        <Callout tone="critical" icon="incident" kicker="Symptoms">
          <ul className="symptoms">
            {inc.symptoms.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Callout>
      </div>

      <div className="incident-investigate">
        <h4 className="step-head">
          <span className="step-num" aria-hidden="true">
            1
          </span>
          <Tip text={`Walk to equipment in the room (walking takes clock time too) or click it here. Each look takes ${lookSeconds < 2 ? "about a second" : `${Math.round(lookSeconds)} seconds`} of clock time. Monitoring makes it faster.`}>
            Find the cause
          </Tip>
        </h4>
        <div className="chips">
          {places.map((id) => {
            const checked = inc.evidence.some((e) => e.equipment === id);
            const busy = inc.inspecting?.equipment === id;
            return (
              <button
                type="button"
                key={id}
                className={`chip${checked ? " is-done" : ""}${busy ? " is-busy" : ""}${symptomatic.includes(id) ? " is-alert" : ""}`}
                disabled={checked || !!inc.inspecting}
                onClick={() => inspectOrSelect(id)}
              >
                <span className="chip-icon" aria-hidden="true">
                  <Icon name={checked ? "check" : busy ? "search" : EQUIPMENT_ICON[id]} size={16} />
                </span>
                {equipmentInfo(game, id).name}
              </button>
            );
          })}
        </div>
        {inc.inspecting && <Meter value={1 - inc.inspecting.remaining / inc.inspecting.total} tone="warn" label="Investigation progress" />}
        {inc.evidence.length > 0 && (
          <ul className="evidence">
            {[...inc.evidence].reverse().map((e) => (
              <li key={e.equipment}>
                <Callout compact tone={e.anomalous ? "warn" : "info"} icon={e.anomalous ? "alert" : "search"} kicker={e.title}>
                  {e.text}
                </Callout>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h4 className="step-head">
        <span className="step-num" aria-hidden="true">
          2
        </span>
        Pick the fix
      </h4>
      {pending && (
        <div className="working">
          <span>{options.find((o) => o.id === pending.id)?.label}…</span>
          <Meter value={1 - pending.remaining / pending.total} tone="accent" label="Action progress" />
        </div>
      )}
      <ul className="actions">
        {usable.map((o) => (
          <li key={o.id}>
            <button type="button" className="action" title={o.description} disabled={!!pending} onClick={() => act({ type: "incident_action", recovery: o.id })}>
              <span className="action-title">{o.label}</span>
              <span className="price">
                <Icon name="cash" size={12} />
                {o.costNote ?? (o.cost > 0 ? moneyFull(o.cost) : "Free")}
              </span>
              <span className="price">
                <Icon name="latency" size={12} />
                {o.secondsNote ?? `${o.seconds}s`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {blocked.length > 0 && (
        <details className="more">
          <summary>Not available ({blocked.length})</summary>
          <ul className="plain-list">
            {blocked.map((o) => (
              <li key={o.id}>
                {o.label}: <span className="muted">{o.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {inc.attempts.length > 0 && (
        <ul className="attempts">
          {[...inc.attempts].reverse().map((a, i) => (
            <li key={`${a.id}-${i}`}>
              <Callout compact tone={ATTEMPT[a.outcome]?.tone ?? "info"} icon={ATTEMPT[a.outcome]?.icon ?? "info"} kicker={`${a.label}: ${ATTEMPT[a.outcome]?.word ?? a.outcome}`}>
                {a.note}
              </Callout>
            </li>
          ))}
        </ul>
      )}

      <div className="hint-box">
        {inc.hints.map((h) => (
          <Callout key={h} tone="hint" icon="bulb" kicker="Hint">
            {h}
          </Callout>
        ))}
        {inc.hints.length < 2 && (
          <button type="button" className="btn btn-small" onClick={() => act({ type: "incident_hint" })}>
            <Icon name="bulb" size={16} />
            Hint
          </button>
        )}
      </div>
    </section>
  );
}
