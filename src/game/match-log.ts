import type { MatchView, TurnResult } from '@/game/types';

/**
 * 試合経過パネルに表示する公開情報だけの行。
 *
 * `MatchView` には result まで wiredChair が含まれないため、現在行の
 * wiredChair は常に null（UI では `???`）になる。履歴行だけが press 済みの
 * wiredChair を持つ。
 */
export type MatchLogResult = 'SHOCK' | 'SAFE' | '—';

export interface MatchLogRow {
  readonly turn: number;
  readonly attacker: string;
  readonly sittingChair: number | null;
  readonly wiredChair: number | null;
  readonly result: MatchLogResult;
  readonly points: readonly [number, number];
  readonly current: boolean;
}

/** パネルに表示する最大行数。超えた分は古い履歴から落とす。 */
export const MATCH_LOG_MAX_ROWS = 8;

function toHistoryRow(view: MatchView, result: TurnResult): MatchLogRow {
  return {
    turn: result.turn,
    attacker: view.players[result.attacker].name,
    sittingChair: result.sittingChair,
    wiredChair: result.wiredChair,
    result: result.hit ? 'SHOCK' : 'SAFE',
    points: result.pointsAfter,
    current: false,
  };
}

/**
 * 公開済みの history と、進行中の現在ターンから試合経過の行を作る。
 *
 * - 履歴行は result の公開情報（wiredChair / hit / pointsAfter）を使う
 * - 現在行は `view.sittingChair` だけを使い、電気イスは絶対に出さない
 * - result フェーズなど history に同ターンがある場合は現在行を重複させない
 * - finished は現在行を追加しない
 * - 最大 `MATCH_LOG_MAX_ROWS` 行（現在行を含む場合は現在行を優先して残す）
 */
export function buildMatchLogRows(view: MatchView): MatchLogRow[] {
  const rows: MatchLogRow[] = view.history.map((result) => toHistoryRow(view, result));
  const currentTurnIsPublished = view.history.some((result) => result.turn === view.turn);

  if (view.phase !== 'finished' && !currentTurnIsPublished) {
    rows.push({
      turn: view.turn,
      attacker: view.players[view.attacker].name,
      sittingChair: view.sittingChair,
      wiredChair: null,
      result: '—',
      points: [view.players[0].points, view.players[1].points],
      current: true,
    });
  }

  return rows.slice(-MATCH_LOG_MAX_ROWS);
}
