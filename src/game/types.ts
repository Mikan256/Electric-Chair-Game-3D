/**
 * Pure game types for the electric-chair game.
 *
 * Turn order (the real show):
 *   1. attacker secretly sets the electric chair (the "button position")
 *   2. defender chooses and sits on a chair (public)
 *   3. attacker presses the button at the front pedestal
 *   4. result
 *
 * This module must stay free of three.js, DOM and network imports so the
 * rules can be simulated headlessly and unit-tested.
 */

export const CHAIR_COUNT = 12;

export type PlayerIndex = 0 | 1;
export type Phase = 'set' | 'sit' | 'press' | 'result' | 'finished';

export type EndReason = 'points' | 'shocks' | 'turn-limit' | 'draw' | 'forfeit' | 'abandoned';

export interface MatchConfig {
  /** 1ターン = 攻撃側1人。最大16ターン（= 攻守が各8回ずつ攻撃 = 8ラウンド）。 */
  readonly maxTurns: number;
  /** 40ポイント先取。 */
  readonly targetPoints: number;
  /** 相手を3回感電させると勝利。 */
  readonly shocksToWin: number;
  /** 椅子の数（1〜chairCount）。 */
  readonly chairCount: number;
}

export const DEFAULT_CONFIG: MatchConfig = {
  maxTurns: 16,
  targetPoints: 40,
  shocksToWin: 3,
  chairCount: CHAIR_COUNT,
};

export interface PlayerIdentity {
  readonly id: string;
  readonly name: string;
}

export interface MatchPlayer extends PlayerIdentity {
  points: number;
  /** このプレイヤーが相手に感電させた回数。 */
  shocksDealt: number;
}

export interface TurnResult {
  readonly turn: number;
  readonly attacker: PlayerIndex;
  readonly defender: PlayerIndex;
  readonly wiredChair: number;
  readonly sittingChair: number;
  readonly hit: boolean;
  readonly pointsAwarded: number;
  readonly pointsLost: number;
  /** 得点したため使用不可になった椅子。感電した椅子は残る。 */
  readonly retiredChair: number | null;
  readonly pointsAfter: readonly [number, number];
  readonly shocksAfter: readonly [number, number];
}

export interface MatchOutcome {
  readonly kind: 'win' | 'draw';
  readonly winner: PlayerIndex | null;
  readonly reason: EndReason;
}

export interface MatchState {
  readonly matchId: string;
  readonly config: MatchConfig;
  readonly players: readonly [MatchPlayer, MatchPlayer];
  readonly phase: Phase;
  /** 現在のターン番号（1 始まり）。 */
  readonly turn: number;
  /** 守備側が確認前に選択している公開プレビュー。 */
  readonly previewChair: number | null;
  /** 電気イスを仕掛け、ボタンを押す側。 */
  readonly attacker: PlayerIndex;
  /** 攻撃側が仕掛けた椅子のコミットメント。press まで椅子は不明。 */
  readonly wiredCommitment: string | null;
  /** 守備側が座った椅子。sit 以降は公開。 */
  readonly sittingChair: number | null;
  /** press で確定した電気椅子。result まで View には出さない。 */
  readonly wiredChair: number | null;
  readonly retiredChairs: readonly number[];
  readonly history: readonly TurnResult[];
  readonly lastResult: TurnResult | null;
  readonly outcome: MatchOutcome | null;
  readonly revision: number;
}

export interface MatchViewPlayer {
  readonly id: string;
  readonly name: string;
  readonly points: number;
  readonly shocksDealt: number;
}

/**
 * ネットワークで共有してよい公開ビュー。
 * wiredChair は result まで含めない。previewChair は選択中の椅子を公開し、
 * sittingChair は守備側が確定した時点で公開。
 */
export interface MatchView {
  readonly matchId: string;
  readonly config: MatchConfig;
  readonly players: readonly [MatchViewPlayer, MatchViewPlayer];
  readonly phase: Phase;
  readonly turn: number;
  /** 2ターンごとのラウンド番号（1 始まり）。 */
  readonly round: number;
  /** 試合設定に基づく最大ラウンド数。 */
  readonly maxRounds: number;
  readonly attacker: PlayerIndex;
  readonly wiredCommitted: boolean;
  readonly previewChair: number | null;
  readonly sittingChair: number | null;
  readonly retiredChairs: readonly number[];
  readonly availableChairs: readonly number[];
  readonly history: readonly TurnResult[];
  readonly lastResult: TurnResult | null;
  readonly outcome: MatchOutcome | null;
  readonly revision: number;
  /** このビューを受け取ったプレイヤー。 */
  readonly you: PlayerIndex;
}

export type MatchAction =
  /** 攻撃側が電気椅子を仕掛ける（ハッシュのみ）。 */
  | { readonly type: 'set'; readonly player: PlayerIndex; readonly hash: string }
  /** 守備側が確定前の座る椅子を選択・解除する。 */
  | { readonly type: 'select'; readonly player: PlayerIndex; readonly chair: number | null }
  /** 守備側が座る椅子を選ぶ。 */
  | { readonly type: 'sit'; readonly player: PlayerIndex; readonly chair: number }
  /** 攻撃側が前の台座のボタンを押す（仕掛けた椅子を公開）。 */
  | {
      readonly type: 'press';
      readonly player: PlayerIndex;
      readonly chair: number;
      readonly salt: string;
    }
  | { readonly type: 'advance' }
  | { readonly type: 'forfeit'; readonly player: PlayerIndex };

export type MatchErrorCode =
  | 'INVALID_PHASE'
  | 'INVALID_PLAYER'
  | 'INVALID_CHAIR'
  | 'CHAIR_RETIRED'
  | 'INVALID_HASH'
  | 'ALREADY_SET'
  | 'ALREADY_SEATED'
  | 'COMMITMENT_MISMATCH'
  | 'MATCH_FINISHED'
  | 'NOT_READY';

export interface MatchError {
  readonly ok: false;
  readonly code: MatchErrorCode;
  readonly message: string;
}

export type ActionResult = { readonly ok: true; readonly state: MatchState } | MatchError;

export type { ActionResult as ApplyResult };
