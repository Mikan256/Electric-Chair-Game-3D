/**
 * Pure, deterministic rules engine for the electric-chair game.
 *
 * Turn lifecycle:
 *   commit (both players secretly commit to a salted hash)
 *     -> reveal (both reveal; the choices stay hidden until both are in)
 *     -> result (both choices and the outcome are public)
 *     -> next turn / finished
 *
 * The host is authoritative, but it cannot see a secret before the commit
 * phase is over, which makes hosting fair. A player who refuses to reveal
 * forfeits the match; the host cannot fabricate their secret.
 */
import { randomId, randomInt, verifyCommitment } from './rng';
import {
  DEFAULT_CONFIG,
  type ActionResult,
  type MatchAction,
  type MatchConfig,
  type MatchError,
  type MatchErrorCode,
  type MatchOutcome,
  type MatchState,
  type MatchView,
  type PlayerIdentity,
  type PlayerIndex,
  type RevealSecret,
  type TurnResult,
} from './types';

export interface CreateMatchOptions {
  readonly matchId?: string;
  readonly players: readonly [PlayerIdentity, PlayerIdentity];
  readonly startingAttacker?: PlayerIndex;
  readonly config?: Partial<MatchConfig>;
  readonly now?: number;
  /** 先攻抽選に使うシード。省略時は matchId。 */
  readonly seed?: string;
}

export function otherPlayer(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

export function getDefender(state: MatchState): PlayerIndex {
  return otherPlayer(state.attacker);
}

export function availableChairs(state: {
  config: Pick<MatchConfig, 'chairCount'>;
  retiredChairs: readonly number[];
}): number[] {
  const retired = new Set(state.retiredChairs);
  const chairs: number[] = [];
  for (let chair = 1; chair <= state.config.chairCount; chair += 1) {
    if (!retired.has(chair)) chairs.push(chair);
  }
  return chairs;
}

export function isChairLegal(state: MatchState, chair: number): boolean {
  return (
    Number.isInteger(chair) &&
    chair >= 1 &&
    chair <= state.config.chairCount &&
    !state.retiredChairs.includes(chair)
  );
}

export function createMatch(options: CreateMatchOptions): MatchState {
  const now = options.now ?? Date.now();
  const config: MatchConfig = { ...DEFAULT_CONFIG, ...options.config };
  const matchId = options.matchId ?? randomId('match');
  const seed = options.seed ?? matchId;
  const attacker: PlayerIndex = options.startingAttacker ?? (randomInt(seed, 0, 1) as PlayerIndex);

  return {
    matchId,
    config,
    players: [
      { ...options.players[0], points: 0, shocksDealt: 0 },
      { ...options.players[1], points: 0, shocksDealt: 0 },
    ],
    phase: 'commit',
    turn: 1,
    attacker,
    commitments: [null, null],
    reveals: [null, null],
    retiredChairs: [],
    history: [],
    lastResult: null,
    outcome: null,
    deadline: now + config.commitMs,
    revision: 0,
  };
}

function fail(code: MatchErrorCode, message: string): MatchError {
  return { ok: false, code, message };
}

function bump(state: MatchState, patch: Partial<MatchState>): MatchState {
  return { ...state, ...patch, revision: state.revision + 1 };
}

function bothCommitted(state: MatchState): boolean {
  return state.commitments[0] !== null && state.commitments[1] !== null;
}

function bothRevealed(state: MatchState): boolean {
  return state.reveals[0] !== null && state.reveals[1] !== null;
}

function beginReveal(state: MatchState, now: number): MatchState {
  return bump(state, {
    phase: 'reveal',
    deadline: now + state.config.revealMs,
  });
}

function finish(state: MatchState, outcome: MatchOutcome): MatchState {
  return bump(state, {
    phase: 'finished',
    outcome,
    deadline: 0,
  });
}

function resolveTurn(state: MatchState, now: number): MatchState {
  const wired = state.reveals[state.attacker];
  const sitting = state.reveals[getDefender(state)];
  if (!wired || !sitting) {
    throw new Error('resolveTurn called without both reveals');
  }

  const hit = wired.chair === sitting.chair;
  const defender = getDefender(state);
  const pointsBefore: [number, number] = [state.players[0].points, state.players[1].points];
  const shocksBefore: [number, number] = [
    state.players[0].shocksDealt,
    state.players[1].shocksDealt,
  ];

  const points: [number, number] = [...pointsBefore];
  const shocks: [number, number] = [...shocksBefore];
  let retiredChair: number | null = null;

  if (hit) {
    points[defender] = 0;
    shocks[state.attacker] = shocks[state.attacker] + 1;
  } else {
    points[defender] = points[defender] + sitting.chair;
    retiredChair = sitting.chair;
  }

  const pointsAfter: [number, number] = [points[0], points[1]];
  const shocksAfter: [number, number] = [shocks[0], shocks[1]];
  const result: TurnResult = {
    turn: state.turn,
    attacker: state.attacker,
    defender,
    wiredChair: wired.chair,
    sittingChair: sitting.chair,
    hit,
    pointsAwarded: hit ? 0 : sitting.chair,
    pointsLost: hit ? pointsBefore[defender] : 0,
    retiredChair,
    pointsAfter,
    shocksAfter,
  };

  const retiredChairs =
    retiredChair === null ? state.retiredChairs : [...state.retiredChairs, retiredChair];

  let outcome: MatchOutcome | null = null;
  if (shocksAfter[state.attacker] >= state.config.shocksToWin) {
    outcome = { kind: 'win', winner: state.attacker, reason: 'shocks' };
  } else if (pointsAfter[defender] >= state.config.targetPoints) {
    outcome = { kind: 'win', winner: defender, reason: 'points' };
  } else if (state.turn >= state.config.maxTurns) {
    if (pointsAfter[0] === pointsAfter[1]) {
      outcome = { kind: 'draw', winner: null, reason: 'draw' };
    } else {
      const winner: PlayerIndex = pointsAfter[0] > pointsAfter[1] ? 0 : 1;
      outcome = { kind: 'win', winner, reason: 'turn-limit' };
    }
  }

  return bump(state, {
    players: [
      { ...state.players[0], points: pointsAfter[0], shocksDealt: shocksAfter[0] },
      { ...state.players[1], points: pointsAfter[1], shocksDealt: shocksAfter[1] },
    ],
    retiredChairs,
    history: [...state.history, result],
    lastResult: result,
    outcome,
    phase: 'result',
    deadline: now + state.config.resultMs,
  });
}

function nextTurn(state: MatchState, now: number): MatchState {
  if (state.outcome) {
    return finish(state, state.outcome);
  }
  return bump(state, {
    phase: 'commit',
    turn: state.turn + 1,
    attacker: getDefender(state),
    commitments: [null, null],
    reveals: [null, null],
    deadline: now + state.config.commitMs,
  });
}

function applyTimeout(state: MatchState, now: number): ActionResult {
  if (state.phase === 'finished') {
    return fail('MATCH_FINISHED', '試合は終了しています');
  }

  if (state.phase === 'commit') {
    const missing: PlayerIndex[] = [];
    for (const player of [0, 1] as const) {
      if (state.commitments[player] === null) missing.push(player);
    }
    if (missing.length === 2) {
      return {
        ok: true,
        state: finish(state, { kind: 'draw', winner: null, reason: 'abandoned' }),
      };
    }
    const loser = missing[0]!;
    return {
      ok: true,
      state: finish(state, { kind: 'win', winner: otherPlayer(loser), reason: 'forfeit' }),
    };
  }

  if (state.phase === 'reveal') {
    const missing: PlayerIndex[] = [];
    for (const player of [0, 1] as const) {
      if (state.reveals[player] === null) missing.push(player);
    }
    if (missing.length === 2) {
      return {
        ok: true,
        state: finish(state, { kind: 'draw', winner: null, reason: 'abandoned' }),
      };
    }
    const loser = missing[0]!;
    return {
      ok: true,
      state: finish(state, { kind: 'win', winner: otherPlayer(loser), reason: 'forfeit' }),
    };
  }

  // result: 自動で次へ進む。
  return { ok: true, state: nextTurn(state, now) };
}

export function applyAction(
  state: MatchState,
  action: MatchAction,
  now = Date.now(),
): ActionResult {
  if (state.phase === 'finished') {
    return fail('MATCH_FINISHED', '試合は終了しています');
  }

  switch (action.type) {
    case 'commit': {
      if (state.phase !== 'commit') {
        return fail('INVALID_PHASE', `commit できないフェーズです: ${state.phase}`);
      }
      const { player } = action;
      if (player !== 0 && player !== 1) {
        return fail('INVALID_PLAYER', 'プレイヤー番号が不正です');
      }
      if (!/^[0-9a-f]{8,64}$/i.test(action.hash)) {
        return fail('INVALID_HASH', 'コミットメントの形式が不正です');
      }
      if (state.commitments[player] !== null) {
        return fail('ALREADY_COMMITTED', 'すでにコミット済みです');
      }
      const commitments: [string | null, string | null] = [...state.commitments];
      commitments[player] = action.hash.toLowerCase();
      const committed = { ...state, commitments };
      return {
        ok: true,
        state: bothCommitted(committed)
          ? beginReveal(committed, now)
          : bump(state, { commitments }),
      };
    }

    case 'reveal': {
      if (state.phase !== 'reveal') {
        return fail('INVALID_PHASE', `reveal できないフェーズです: ${state.phase}`);
      }
      const { player, chair, salt } = action;
      if (player !== 0 && player !== 1) {
        return fail('INVALID_PLAYER', 'プレイヤー番号が不正です');
      }
      if (state.reveals[player] !== null) {
        return fail('ALREADY_REVEALED', 'すでに公開済みです');
      }
      const commitment = state.commitments[player];
      if (commitment === null) {
        return fail('COMMITMENT_MISMATCH', 'コミットメントがありません');
      }
      if (!verifyCommitment(commitment, chair, salt)) {
        return fail('COMMITMENT_MISMATCH', 'コミットメントと選択が一致しません');
      }
      if (!isChairLegal(state, chair)) {
        return fail('INVALID_CHAIR', 'その椅子は選択できません');
      }
      const reveals: [RevealSecret | null, RevealSecret | null] = [...state.reveals];
      reveals[player] = { chair, salt };
      const revealed = { ...state, reveals };
      if (bothRevealed(revealed)) {
        return { ok: true, state: resolveTurn(revealed, now) };
      }
      return { ok: true, state: bump(state, { reveals }) };
    }

    case 'advance': {
      if (state.phase !== 'result') {
        return fail('INVALID_PHASE', `advance できないフェーズです: ${state.phase}`);
      }
      return { ok: true, state: nextTurn(state, now) };
    }

    case 'timeout': {
      return applyTimeout(state, now);
    }

    case 'forfeit': {
      const { player } = action;
      if (player !== 0 && player !== 1) {
        return fail('INVALID_PLAYER', 'プレイヤー番号が不正です');
      }
      return {
        ok: true,
        state: finish(state, { kind: 'win', winner: otherPlayer(player), reason: 'forfeit' }),
      };
    }

    default:
      return fail('NOT_READY', '不明なアクションです');
  }
}

export function createView(state: MatchState, you: PlayerIndex): MatchView {
  return {
    matchId: state.matchId,
    config: state.config,
    players: [
      {
        id: state.players[0].id,
        name: state.players[0].name,
        points: state.players[0].points,
        shocksDealt: state.players[0].shocksDealt,
        revealed: state.reveals[0] !== null,
        committed: state.commitments[0] !== null,
      },
      {
        id: state.players[1].id,
        name: state.players[1].name,
        points: state.players[1].points,
        shocksDealt: state.players[1].shocksDealt,
        revealed: state.reveals[1] !== null,
        committed: state.commitments[1] !== null,
      },
    ],
    phase: state.phase,
    turn: state.turn,
    attacker: state.attacker,
    commitments: state.commitments,
    retiredChairs: state.retiredChairs,
    availableChairs: availableChairs(state),
    history: state.history,
    lastResult: state.lastResult,
    outcome: state.outcome,
    deadline: state.deadline,
    revision: state.revision,
    you,
  };
}
