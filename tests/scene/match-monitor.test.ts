import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/game/types';
import type { MatchView, MatchViewPlayer, TurnResult } from '@/game/types';
import {
  monitorChairLabel,
  monitorHeadline,
  monitorPhaseLabel,
  monitorRoundLabel,
} from '@/scene/match-monitor';

function player(name: string, points = 0, shocksDealt = 0): MatchViewPlayer {
  return { id: name.toLowerCase(), name, points, shocksDealt };
}

function turnResult(overrides: Partial<TurnResult> & Pick<TurnResult, 'turn'>): TurnResult {
  return {
    attacker: 0,
    defender: 1,
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
  const turn = overrides.turn ?? 1;
  return {
    matchId: 'match-1',
    config: DEFAULT_CONFIG,
    players: [player('Alice'), player('Bob')],
    phase: 'set',
    turn,
    // 攻撃→守備の 1 組で 1 ラウンド。
    round: Math.ceil(turn / 2),
    maxRounds: 8,
    attacker: 0,
    wiredCommitted: true,
    sittingChair: null,
    previewChair: null,
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

describe('monitorHeadline', () => {
  it('待機・仕掛け・着席はロゴ見出し', () => {
    expect(monitorHeadline(makeView({ phase: 'set' }))).toBe('MATCH LOG');
    expect(monitorHeadline(makeView({ phase: 'sit', sittingChair: 5 }))).toBe('MATCH LOG');
  });

  it('press は FINAL THUNDER（仕掛け椅子が分かっても変えない）', () => {
    const view = makeView({ phase: 'press', turn: 3, sittingChair: 6 });
    expect(monitorHeadline(view)).toBe('FINAL THUNDER');
  });

  it('result は lastResult に応じて SHOCK / SAFE', () => {
    const shock = makeView({
      phase: 'result',
      turn: 2,
      lastResult: turnResult({ turn: 2, hit: true }),
    });
    const safe = makeView({
      phase: 'result',
      turn: 2,
      lastResult: turnResult({ turn: 2, hit: false }),
    });

    expect(monitorHeadline(shock)).toBe('SHOCK');
    expect(monitorHeadline(safe)).toBe('SAFE');
  });

  it('result でも lastResult が無ければ RESULT', () => {
    expect(monitorHeadline(makeView({ phase: 'result', lastResult: null }))).toBe('RESULT');
  });

  it('finished は FINISHED', () => {
    expect(
      monitorHeadline(
        makeView({
          phase: 'finished',
          outcome: { kind: 'win', winner: 0, reason: 'points' },
        }),
      ),
    ).toBe('FINISHED');
  });
});

describe('monitorRoundLabel', () => {
  it('攻撃+守備の 1 組を 1 ラウンドとして round / maxRounds を出す', () => {
    expect(monitorRoundLabel(makeView({ turn: 1, round: 1 }))).toBe('ROUND 01 / 08');
    expect(monitorRoundLabel(makeView({ turn: 3, round: 2 }))).toBe('ROUND 02 / 08');
    expect(monitorRoundLabel(makeView({ turn: 16, round: 8 }))).toBe('ROUND 08 / 08');
  });

  it('TURN ではなく ROUND 表記を使う', () => {
    const label = monitorRoundLabel(makeView({ turn: 5, round: 3 }));
    expect(label).toContain('ROUND');
    expect(label).not.toContain('TURN');
  });
});

describe('monitorPhaseLabel', () => {
  it('全フェーズの英日ラベルを返す', () => {
    expect(monitorPhaseLabel(makeView({ phase: 'set' }))).toBe('SET / 仕掛け中');
    expect(monitorPhaseLabel(makeView({ phase: 'sit' }))).toBe('SIT / 着席待ち');
    expect(monitorPhaseLabel(makeView({ phase: 'press' }))).toBe('PRESS / ボタン待ち');
    expect(monitorPhaseLabel(makeView({ phase: 'result' }))).toBe('RESULT / 判定');
    expect(monitorPhaseLabel(makeView({ phase: 'finished' }))).toBe('FINISHED / 終了');
  });
});

describe('monitorChairLabel', () => {
  it('press 中は着席済みでも CHAIR ?? のまま', () => {
    const view = makeView({ phase: 'press', turn: 2, sittingChair: 6 });
    expect(monitorChairLabel(view)).toBe('CHAIR ??');
  });

  it('着席前は null、着席後は公開済みの sittingChair を出す', () => {
    expect(monitorChairLabel(makeView({ phase: 'set', sittingChair: null }))).toBeNull();
    expect(monitorChairLabel(makeView({ phase: 'set', sittingChair: 3 }))).toBe('CHAIR #3');
    expect(monitorChairLabel(makeView({ phase: 'sit', sittingChair: 7 }))).toBe('CHAIR #7');
  });

  it('result / finished は lastResult.sittingChair を使う', () => {
    const view = makeView({
      phase: 'result',
      sittingChair: 2,
      lastResult: turnResult({ turn: 4, sittingChair: 8, wiredChair: 11 }),
    });
    expect(monitorChairLabel(view)).toBe('CHAIR #8');

    const finished = makeView({
      phase: 'finished',
      lastResult: turnResult({ turn: 8, sittingChair: 5 }),
      outcome: { kind: 'win', winner: 1, reason: 'shocks' },
    });
    expect(monitorChairLabel(finished)).toBe('CHAIR #5');
  });

  it('result で lastResult が無ければ椅子を出さない', () => {
    expect(monitorChairLabel(makeView({ phase: 'result', lastResult: null }))).toBeNull();
  });
});
