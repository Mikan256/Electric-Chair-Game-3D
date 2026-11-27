import { describe, expect, it } from 'vitest';
import { buildMatchLogRows } from '@/game/match-log';
import type { MatchView, MatchViewPlayer, TurnResult } from '@/game/types';

function player(name: string, points = 0, shocksDealt = 0): MatchViewPlayer {
  return { id: name.toLowerCase(), name, points, shocksDealt };
}

const ALL_CHAIRS = Array.from({ length: 12 }, (_, index) => index + 1);

function makeView(overrides: Partial<MatchView> = {}): MatchView {
  const base: MatchView = {
    matchId: 'match-log-test',
    config: { maxTurns: 8, targetPoints: 40, shocksToWin: 3, chairCount: 12 },
    players: [player('Alice'), player('Bob')],
    phase: 'set',
    turn: 1,
    round: 1,
    maxRounds: 4,
    attacker: 0,
    wiredCommitted: false,
    previewChair: null,
    sittingChair: null,
    retiredChairs: [],
    availableChairs: ALL_CHAIRS,
    history: [],
    lastResult: null,
    outcome: null,
    revision: 1,
    you: 0,
  };
  return { ...base, ...overrides };
}

function makeResult(turn: number, overrides: Partial<Omit<TurnResult, 'turn'>> = {}): TurnResult {
  return {
    turn,
    attacker: 0,
    defender: 1,
    wiredChair: 5,
    sittingChair: 3,
    hit: false,
    pointsAwarded: 3,
    pointsLost: 0,
    retiredChair: 3,
    pointsAfter: [0, 3],
    shocksAfter: [0, 0],
    ...overrides,
  };
}

describe('buildMatchLogRows', () => {
  it('履歴がなく set フェーズなら現在行だけを返す', () => {
    const rows = buildMatchLogRows(makeView());

    expect(rows).toEqual([
      {
        turn: 1,
        attacker: 'Alice',
        sittingChair: null,
        wiredChair: null,
        result: '—',
        points: [0, 0],
        current: true,
      },
    ]);
  });

  it('履歴は result の公開情報から SHOCK / SAFE・電流・PTS を作る', () => {
    const history = [
      makeResult(1, {
        attacker: 0,
        wiredChair: 7,
        sittingChair: 4,
        hit: false,
        pointsAfter: [0, 4],
        retiredChair: 4,
      }),
      makeResult(2, {
        attacker: 1,
        wiredChair: 3,
        sittingChair: 9,
        hit: true,
        pointsAfter: [0, 0],
        shocksAfter: [0, 1],
        retiredChair: null,
      }),
    ];

    const rows = buildMatchLogRows(
      makeView({ phase: 'result', turn: 2, attacker: 1, sittingChair: 9, history }),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      turn: 1,
      attacker: 'Alice',
      sittingChair: 4,
      wiredChair: 7,
      result: 'SAFE',
      points: [0, 4],
      current: false,
    });
    expect(rows[1]).toEqual({
      turn: 2,
      attacker: 'Bob',
      sittingChair: 9,
      wiredChair: 3,
      result: 'SHOCK',
      points: [0, 0],
      current: false,
    });
  });

  it('result フェーズで history に同ターンがある場合は現在行を重複させない', () => {
    const history = [makeResult(2, { attacker: 1, wiredChair: 8, hit: true })];
    const rows = buildMatchLogRows(
      makeView({
        phase: 'result',
        turn: 2,
        attacker: 1,
        sittingChair: 8,
        history,
        lastResult: history[0] ?? null,
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.current).toBe(false);
    expect(rows[0]?.wiredChair).toBe(8);
  });

  it('現在行は sittingChair を公開するが wiredChair は出さない', () => {
    const rows = buildMatchLogRows(
      makeView({
        phase: 'press',
        turn: 3,
        attacker: 1,
        sittingChair: 6,
        players: [player('Alice', 12, 1), player('Bob', 7, 2)],
        history: [makeResult(1), makeResult(2)],
      }),
    );

    const current = rows.at(-1);
    expect(current).toEqual({
      turn: 3,
      attacker: 'Bob',
      sittingChair: 6,
      wiredChair: null,
      result: '—',
      points: [12, 7],
      current: true,
    });
  });

  it('finished は現在行を追加しない', () => {
    const history = [makeResult(1), makeResult(2)];
    const rows = buildMatchLogRows(
      makeView({ phase: 'finished', turn: 2, history, outcome: null }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.current)).toBe(true);
  });

  it('最大8行に収め、現在行は必ず残す', () => {
    const history = Array.from({ length: 8 }, (_, index) => makeResult(index + 1));
    const rows = buildMatchLogRows(makeView({ phase: 'set', turn: 9, history }));

    expect(rows).toHaveLength(8);
    expect(rows[0]?.turn).toBe(2);
    expect(rows[7]?.turn).toBe(9);
    expect(rows.at(-1)?.current).toBe(true);
  });

  it('履歴だけでも最大8行に収める', () => {
    const history = Array.from({ length: 9 }, (_, index) => makeResult(index + 1));
    const rows = buildMatchLogRows(makeView({ phase: 'finished', turn: 9, history }));

    expect(rows).toHaveLength(8);
    expect(rows[0]?.turn).toBe(2);
    expect(rows.at(-1)?.turn).toBe(9);
  });

  it('MatchView に余計な非公開プロパティがあっても行へ漏らさない', () => {
    const viewWithSecret = {
      ...makeView({ phase: 'press', turn: 4, attacker: 0, sittingChair: 11 }),
      wiredChair: 9,
      wiredCommitment: 'secret-commitment',
    } as MatchView & { wiredChair: number; wiredCommitment: string };

    const rows = buildMatchLogRows(viewWithSecret);
    const current = rows.at(-1);

    expect(current?.wiredChair).toBeNull();
    expect(Object.keys(current ?? {}).sort()).toEqual([
      'attacker',
      'current',
      'points',
      'result',
      'sittingChair',
      'turn',
      'wiredChair',
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret-commitment');
    expect(JSON.stringify(rows)).not.toContain('"wiredChair":9');
  });

  it('現在行のポイントは view.players の現在値を使う', () => {
    const rows = buildMatchLogRows(
      makeView({
        phase: 'sit',
        turn: 5,
        attacker: 0,
        players: [player('Alice', 40, 2), player('Bob', 0, 3)],
        history: [makeResult(1, { pointsAfter: [3, 0] })],
      }),
    );

    expect(rows[0]?.points).toEqual([3, 0]);
    expect(rows[1]?.points).toEqual([40, 0]);
  });
});
