import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/game/types';
import type { MatchView, MatchViewPlayer } from '@/game/types';
import {
  FINAL_THUNDER_HIGH_STAKES_PRE_PRESS_MS,
  FINAL_THUNDER_STANDARD_PRE_PRESS_MS,
  finalThunderTiming,
} from '@/game/timing';

function player(name: string, shocksDealt: number): MatchViewPlayer {
  return { id: name, name, points: 0, shocksDealt };
}

function view(attackerShocks: number): MatchView {
  const players: readonly [MatchViewPlayer, MatchViewPlayer] = [
    player('Alice', attackerShocks),
    player('Bob', 0),
  ];
  return {
    matchId: 'timing',
    config: DEFAULT_CONFIG,
    players,
    phase: 'press',
    turn: 1,
    round: 1,
    maxRounds: 4,
    attacker: 0,
    wiredCommitted: true,
    previewChair: null,
    sittingChair: 6,
    retiredChairs: [],
    availableChairs: [1, 2, 3],
    history: [],
    lastResult: null,
    outcome: null,
    revision: 1,
    you: 0,
  };
}

describe('finalThunderTiming', () => {
  it('通常は標準のプレス前演出', () => {
    expect(finalThunderTiming(view(0))).toEqual({
      prePressMs: FINAL_THUNDER_STANDARD_PRE_PRESS_MS,
      highStakes: false,
    });
    expect(finalThunderTiming(view(1)).highStakes).toBe(false);
  });

  it('攻撃側がリーチ（shocksToWin - 1）なら長尺', () => {
    expect(finalThunderTiming(view(2))).toEqual({
      prePressMs: FINAL_THUNDER_HIGH_STAKES_PRE_PRESS_MS,
      highStakes: true,
    });
    expect(finalThunderTiming(view(3)).highStakes).toBe(true);
  });
});
