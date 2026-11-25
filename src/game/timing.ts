import type { MatchView } from './types';

/**
 * FINAL THUNDER のプレス前演出。高stakes（相手がリーチ）のときだけ長尺にする。
 * 8ターンすべてを長尺にすると試合が間延びするため、通常は短めにする。
 */
export const FINAL_THUNDER_STANDARD_PRE_PRESS_MS = 3200;
export const FINAL_THUNDER_HIGH_STAKES_PRE_PRESS_MS = 5200;
export const FINAL_THUNDER_RESULT_REVEAL_MS = 900;

/** 旧名の互換用。新規コードは finalThunderTiming(view) を使う。 */
export const FINAL_THUNDER_CUTSCENE_MS = FINAL_THUNDER_STANDARD_PRE_PRESS_MS;

export interface FinalThunderTiming {
  readonly prePressMs: number;
  readonly highStakes: boolean;
}

/**
 * 守備側がリーチ（攻撃側の shock 数が shocksToWin - 1 以上）なら長尺。
 */
export function finalThunderTiming(view: MatchView): FinalThunderTiming {
  const attackerShocks = view.players[view.attacker]?.shocksDealt ?? 0;
  const threshold = Math.max(1, view.config.shocksToWin - 1);
  const highStakes = attackerShocks >= threshold;
  return {
    prePressMs: highStakes
      ? FINAL_THUNDER_HIGH_STAKES_PRE_PRESS_MS
      : FINAL_THUNDER_STANDARD_PRE_PRESS_MS,
    highStakes,
  };
}
