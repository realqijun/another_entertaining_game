import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTurn, EQUIPMENT_ORDER, incidentTick, inspectable, newGame, type GameState } from '../sim';
import { approachPoints, findPath, inRange, nearestInRange } from '../components/scene/nav';
import { body, canMove, roomPlan, SPAWN, usePlayer } from './player';
import { useGame } from './store';

// Delegates to the real path finder unless a test overrides it.
vi.mock('../components/scene/nav', async (original) => {
  const nav = await original<typeof import('../components/scene/nav')>();
  return { ...nav, findPath: vi.fn(nav.findPath) };
});

function place(x: number, z: number) {
  body.x = x;
  body.z = z;
}

function startIncident(): GameState {
  const game = advanceTurn({ ...newGame(1), users: 4500 });
  expect(game.phase).toBe('incident');
  expect(inspectable(game)).toContain('app');
  useGame.setState({ game, started: true, running: true });
  return game;
}

/** Stand at the end of the planned walk, as the scene would after following it. */
function finishWalk() {
  const goal = usePlayer.getState().goal!;
  const last = goal.path.at(-1)!;
  place(last.x, last.z);
  usePlayer.getState().arrive();
}

beforeEach(() => {
  localStorage.clear();
  useGame.setState(useGame.getInitialState(), true);
  usePlayer.setState(usePlayer.getInitialState(), true);
  place(SPAWN.x, SPAWN.z);
});

describe('walking engineer', () => {
  it('spawns on open floor and can reach every piece of equipment', () => {
    for (const game of [newGame(1), { ...newGame(1), engineers: 6, techDone: ['load_balancing', 'standby', 'caching', 'replicas', 'backups', 'monitoring'] } as GameState]) {
      const { footprints, blocks } = roomPlan(game);
      expect(findPath(SPAWN, SPAWN, blocks)).not.toBeNull();
      expect(nearestInRange(SPAWN, footprints, EQUIPMENT_ORDER)).toBeNull();
      for (const id of EQUIPMENT_ORDER) {
        const reachable = approachPoints(footprints[id], SPAWN, blocks).some(p => inRange(p, footprints[id]) && findPath(SPAWN, p, blocks));
        expect(reachable, id).toBe(true);
      }
    }
  });

  it('uses equipment at once when it is already within reach', () => {
    const { footprints } = roomPlan(useGame.getState().game);
    const f = footprints.app;
    place(f.x, f.z + f.d / 2 + 0.5);
    usePlayer.getState().walkTo('app');
    expect(usePlayer.getState().goal).toBeNull();
    expect(useGame.getState().selected).toBe('app');
  });

  it('walks first and only investigates on arrival during an incident', () => {
    startIncident();
    usePlayer.getState().walkTo('app');
    expect(usePlayer.getState().goal?.id).toBe('app');
    expect(useGame.getState().game.incident?.inspecting).toBeNull();
    expect(useGame.getState().selected).toBeNull();
    finishWalk();
    expect(usePlayer.getState().goal).toBeNull();
    expect(useGame.getState().selected).toBe('app');
    expect(useGame.getState().game.incident?.inspecting?.equipment).toBe('app');
  });

  it('does not investigate the same equipment twice', () => {
    startIncident();
    usePlayer.getState().walkTo('app');
    finishWalk();
    let game = useGame.getState().game;
    for (let i = 0; i < 60 && game.incident?.inspecting; i++) game = incidentTick(game, 0.5);
    expect(game.incident?.evidence.some(e => e.equipment === 'app')).toBe(true);
    useGame.setState({ game });
    usePlayer.getState().setNearby('app');
    usePlayer.getState().interact();
    usePlayer.getState().walkTo('app');
    expect(useGame.getState().game).toBe(game);
  });

  it('uses the equipment anyway when no path reaches it, so play never locks', () => {
    startIncident();
    vi.mocked(findPath).mockImplementation(() => null);
    try {
      usePlayer.getState().walkTo('app');
    } finally {
      vi.mocked(findPath).mockRestore();
    }
    expect(usePlayer.getState().goal).toBeNull();
    expect(useGame.getState().game.incident?.inspecting?.equipment).toBe('app');
  });

  it('does nothing on the use key with nothing in reach', () => {
    usePlayer.getState().setNearby(null);
    usePlayer.getState().interact();
    expect(useGame.getState().selected).toBeNull();
  });

  it('holds still while the room is covered or the crisis clock is paused', () => {
    useGame.setState({ started: true });
    expect(canMove(useGame.getState())).toBe(true);
    expect(canMove({ ...useGame.getState(), view: 'tech' })).toBe(false);
    expect(canMove({ ...useGame.getState(), started: false })).toBe(false);
    startIncident();
    expect(canMove(useGame.getState())).toBe(true);
    useGame.getState().setRunning(false);
    expect(canMove(useGame.getState())).toBe(false);
  });
});
