/**
 * Pure game types for the electric-chair game.
 *
 * This module must stay free of three.js, DOM and network imports so that the
 * rules can be simulated headlessly and unit-tested.
 */

export const CHAIR_COUNT = 12;

export type PlayerIndex = 0 | 1;
export type Phase = 'commit' | 'reveal' | 'result' | 'finished';

export type EndReason = 'points' | 'shocks' | 'turn-limit' | 'draw' | 'forfeit' | 'abandoned';

export interface MatchConfig {
  /** 1ターン = 攻撃側1人。最大8ターン（= 各4回ずつ攻撃）。 */
  readonly maxTurns: number;
  /** 40ポイント先取。 */
  readonly targetPoints: number;
  /** 相手を3回感電させると勝利。 */
  readonly shocksToWin: number;
  /** 椅子の数（1〜chairCount）。 */
  readonly chairCount: number;
  readonly commitMs: number;
  readonly revealMs: number;
  readonly resultMs: number;
}

export const DEFAULT_CONFIG: MatchConfig = {
  maxTurns: 8,
  targetPoints: 40,
  shocksToWin: 3,
  chairCount: CHAIR_COUNT,
  commitMs: 30_000,
  revealMs: 15_000,
  resultMs: 7_000,
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

/** 秘密の選択。reveal されるまで相手（と観戦者）には見せない。 */
export interface RevealSecret {
  chair: number;
  salt: string;
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
  readonly attacker: PlayerIndex;
  readonly commitments: readonly [string | null, string | null];
  readonly reveals: readonly [RevealSecret | null, RevealSecret | null];
  readonly retiredChairs: readonly number[];
  readonly history: readonly TurnResult[];
  readonly lastResult: TurnResult | null;
  readonly outcome: MatchOutcome | null;
  /** 現在フェーズの期限（epoch ms）。0 は期限なし。 */
  readonly deadline: number;
  readonly revision: number;
}

export interface MatchViewPlayer {
  readonly id: string;
  readonly name: string;
  readonly points: number;
  readonly shocksDealt: number;
  readonly revealed: boolean;
  readonly committed: boolean;
}

/**
 * ネットワークで共有してよい公開ビュー。
 * reveals（座った椅子・仕掛けた椅子）は result フェーズになるまで含めない。
 */
export interface MatchView {
  readonly matchId: string;
  readonly config: MatchConfig;
  readonly players: readonly [MatchViewPlayer, MatchViewPlayer];
  readonly phase: Phase;
  readonly turn: number;
  readonly attacker: PlayerIndex;
  readonly commitments: readonly [string | null, string | null];
  readonly retiredChairs: readonly number[];
  readonly availableChairs: readonly number[];
  readonly history: readonly TurnResult[];
  readonly lastResult: TurnResult | null;
  readonly outcome: MatchOutcome | null;
  readonly deadline: number;
  readonly revision: number;
  /** このビューを受け取ったプレイヤー。 */
  readonly you: PlayerIndex;
}

export type MatchAction =
  | { readonly type: 'commit'; readonly player: PlayerIndex; readonly hash: string }
  | {
      readonly type: 'reveal';
      readonly player: PlayerIndex;
      readonly chair: number;
      readonly salt: string;
    }
  | { readonly type: 'advance' }
  | { readonly type: 'timeout' }
  | { readonly type: 'forfeit'; readonly player: PlayerIndex };

export type MatchErrorCode =
  | 'INVALID_PHASE'
  | 'INVALID_PLAYER'
  | 'INVALID_CHAIR'
  | 'CHAIR_RETIRED'
  | 'INVALID_HASH'
  | 'ALREADY_COMMITTED'
  | 'ALREADY_REVEALED'
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
