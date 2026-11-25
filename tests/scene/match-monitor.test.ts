import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/game/types';
import type { MatchView, MatchViewPlayer, PlayerIndex, TurnResult } from '@/game/types';
import { buildMonitorRows } from '@/scene/match-monitor';

function player(name: string, points = 0, shocksDealt = 0): MatchViewPlayer {
  return { id: name.toLowerCase(), name, points, shocksDealt };
}

function defaultPlayers(): readonly [MatchViewPlayer, MatchViewPlayer] {
  return [player('Alice'), player('Bob')];
}

function turnResult(overrides: Partial<TurnResult> & Pick<TurnResult, 'turn'>): TurnResult {
  const attacker: PlayerIndex = overrides.attacker ?? 0;
  const defender: PlayerIndex = attacker === 0 ? 1 : 0;
  return {
    attacker,
    defender,
    wiredChair: 9,
    sittingChair: 4,
    hit: false,
    pointsAwarded: 0,
    pointsLost: 0,
    retiredChair: null,
    pointsAfter: [0, 0],
    shocksAfter: [0, 0],
    ...overrides,
  };
}

function makeView(overrides: Partial<MatchView> = {}): MatchView {
  return {
    matchId: 'match-1',
    config: DEFAULT_CONFIG,
    players: defaultPlayers(),
    phase: 'set',
    turn: 1,
    attacker: 0,
    wiredCommitted: true,
    sittingChair: null,
    retiredChairs: [],
    availableChairs: [1, 2, 3],
    history: [],
    lastResult: null,
    outcome: null,
    revision: 1,
    you: 0,
    ...overrides,
  };
}

describe('buildMonitorRows', () => {
  it('history 2件 + 現在ターンで3行になる', () => {
    const view = makeView({
      phase: 'set',
      turn: 3,
      history: [
        turnResult({ turn: 1, pointsAfter: [4, 0] }),
        turnResult({ turn: 2, attacker: 1, pointsAfter: [4, 5] }),
      ],
    });

    const rows = buildMonitorRows(view);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.current)).toEqual([false, false, true]);
    expect(rows.at(-1)?.turn).toBe(3);
  });

  it('history 行は wiredChair / result / pointsAfter が正しい', () => {
    const view = makeView({
      phase: 'result',
      turn: 2,
      history: [
        turnResult({
          turn: 1,
          attacker: 0,
          sittingChair: 5,
          wiredChair: 9,
          hit: true,
          pointsLost: 12,
          pointsAfter: [0, 0],
        }),
        turnResult({
          turn: 2,
          attacker: 1,
          sittingChair: 7,
          wiredChair: 3,
          hit: false,
          pointsAwarded: 7,
          retiredChair: 7,
          pointsAfter: [5, 7],
        }),
      ],
    });

    const rows = buildMonitorRows(view);

    expect(rows[0]).toMatchObject({
      turn: 1,
      attacker: 'Alice',
      sittingChair: 5,
      wiredChair: 9,
      result: 'SHOCK',
      points: [0, 0],
      current: false,
    });
    expect(rows[1]).toMatchObject({
      turn: 2,
      attacker: 'Bob',
      sittingChair: 7,
      wiredChair: 3,
      result: 'SAFE',
      points: [5, 7],
      current: false,
    });
  });

  it('result フェーズでは確定済みの行を二重に追加しない', () => {
    const view = makeView({
      phase: 'result',
      turn: 2,
      history: [
        turnResult({ turn: 1, pointsAfter: [4, 0] }),
        turnResult({ turn: 2, attacker: 1, hit: true, pointsAfter: [4, 0] }),
      ],
    });

    const rows = buildMonitorRows(view);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.turn)).toEqual([1, 2]);
    expect(rows.every((row) => !row.current)).toBe(true);
  });

  it('現在行は wiredChair が null、result が —、sittingChair は公開値のみ', () => {
    const view = makeView({
      phase: 'press',
      turn: 2,
      attacker: 1,
      sittingChair: 6,
      players: [player('Alice', 12, 1), player('Bob', 9, 0)],
      history: [
        turnResult({
          turn: 1,
          attacker: 0,
          sittingChair: 6,
          wiredChair: 11,
          hit: false,
          pointsAfter: [12, 0],
        }),
      ],
    });

    const current = buildMonitorRows(view).at(-1);

    expect(current).toMatchObject({
      turn: 2,
      attacker: 'Bob',
      sittingChair: 6,
      wiredChair: null,
      result: '—',
      points: [12, 9],
      current: true,
    });
  });

  it('着席前の現在行も sittingChair を null のままにする', () => {
    const view = makeView({
      phase: 'set',
      turn: 1,
      attacker: 0,
      sittingChair: null,
    });

    const current = buildMonitorRows(view).at(-1);

    expect(current).toMatchObject({
      sittingChair: null,
      wiredChair: null,
      result: '—',
      current: true,
    });
  });

  it('finished のときは現在行を追加しない', () => {
    const view = makeView({
      phase: 'finished',
      turn: 2,
      history: [turnResult({ turn: 1 }), turnResult({ turn: 2, attacker: 1 })],
      lastResult: turnResult({ turn: 2, attacker: 1 }),
      outcome: { kind: 'win', winner: 1, reason: 'points' },
    });

    const rows = buildMonitorRows(view);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.current)).toBe(true);
    expect(rows.at(-1)?.turn).toBe(2);
  });

  it('5行上限で最新行を残す', () => {
    const history = Array.from({ length: 10 }, (_, index) =>
      turnResult({ turn: index + 1, pointsAfter: [index, 0] }),
    );
    const view = makeView({ phase: 'set', turn: 11, history });

    const rows = buildMonitorRows(view);

    expect(rows).toHaveLength(5);
    expect(rows[0]?.turn).toBe(7);
    expect(rows.at(-1)).toMatchObject({ turn: 11, current: true });
  });

  it('history 8件 + 現在行でも最大5行（現在行を含む）', () => {
    const history = Array.from({ length: 8 }, (_, index) =>
      turnResult({ turn: index + 1, pointsAfter: [index, 0] }),
    );
    const view = makeView({ phase: 'sit', turn: 9, history, sittingChair: 3 });

    const rows = buildMonitorRows(view);

    expect(rows).toHaveLength(5);
    expect(rows[0]?.turn).toBe(5);
    expect(rows.at(-1)).toMatchObject({ turn: 9, sittingChair: 3, current: true });
  });

  it('プレイヤー名と points が現在の players から入る', () => {
    const view = makeView({
      phase: 'set',
      turn: 5,
      attacker: 1,
      players: [player('Alice', 21, 2), player('Bob', 34, 1)],
      history: [turnResult({ turn: 4, attacker: 0, pointsAfter: [21, 34] })],
    });

    const rows = buildMonitorRows(view);

    expect(rows[0]?.attacker).toBe('Alice');
    expect(rows[0]?.points).toEqual([21, 34]);
    expect(rows.at(-1)).toMatchObject({
      attacker: 'Bob',
      points: [21, 34],
      current: true,
    });
  });
});
