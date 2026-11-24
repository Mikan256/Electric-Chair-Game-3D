/**
 * Pure, deterministic rules engine for the electric-chair game.
 *
 * Turn lifecycle (faithful to the show):
 *   set   (attacker secretly commits to one of the 12 chairs)
 *     -> sit   (defender publicly chooses a chair and sits)
 *     -> press (attacker presses the button on the front pedestal;
 *               the committed chair is revealed and compared)
 *     -> result
 *     -> next set / finished
 *
 * The attacker's hidden choice is protected by a salted commitment. The
 * standing host cannot see the wired chair before the button press, and the
 * attacker cannot change it after seeing where the defender sat.
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
  type TurnResult,
} from './types';

export interface CreateMatchOptions {
  readonly matchId?: string;
  readonly players: readonly [PlayerIdentity, PlayerIdentity];
  readonly startingAttacker?: PlayerIndex;
  readonly config?: Partial<MatchConfig>;
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
    phase: 'set',
    turn: 1,
    attacker,
    wiredCommitment: null,
    sittingChair: null,
    wiredChair: null,
    retiredChairs: [],
    history: [],
    lastResult: null,
    outcome: null,
    revision: 0,
  };
}

function fail(code: MatchErrorCode, message: string): MatchError {
  return { ok: false, code, message };
}

function bump(state: MatchState, patch: Partial<MatchState>): MatchState {
  return { ...state, ...patch, revision: state.revision + 1 };
}

function finish(state: MatchState, outcome: MatchOutcome): MatchState {
  return bump(state, {
    phase: 'finished',
    outcome,
  });
}

function resolveTurn(state: MatchState, wiredChair: number): MatchState {
  const sittingChair = state.sittingChair;
  if (sittingChair === null) throw new Error('resolveTurn called without a sitting chair');

  const defender = getDefender(state);
  const hit = wiredChair === sittingChair;
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
    points[defender] = points[defender] + sittingChair;
    retiredChair = sittingChair;
  }

  const pointsAfter: [number, number] = [points[0], points[1]];
  const shocksAfter: [number, number] = [shocks[0], shocks[1]];
  const result: TurnResult = {
    turn: state.turn,
    attacker: state.attacker,
    defender,
    wiredChair,
    sittingChair,
    hit,
    pointsAwarded: hit ? 0 : sittingChair,
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
    wiredChair,
    retiredChairs,
    history: [...state.history, result],
    lastResult: result,
    outcome,
    phase: 'result',
  });
}

function nextTurn(state: MatchState): MatchState {
  if (state.outcome) return finish(state, state.outcome);
  return bump(state, {
    phase: 'set',
    turn: state.turn + 1,
    attacker: getDefender(state),
    wiredCommitment: null,
    sittingChair: null,
    wiredChair: null,
  });
}

export function applyAction(state: MatchState, action: MatchAction): ActionResult {
  if (state.phase === 'finished') {
    return fail('MATCH_FINISHED', '試合は終了しています');
  }

  switch (action.type) {
    case 'set': {
      if (state.phase !== 'set') {
        return fail('INVALID_PHASE', `set できないフェーズです: ${state.phase}`);
      }
      const { player } = action;
      if (player !== 0 && player !== 1) {
        return fail('INVALID_PLAYER', 'プレイヤー番号が不正です');
      }
      if (player !== state.attacker) {
        return fail('INVALID_PLAYER', '電気イスを仕掛けられるのは攻撃側だけです');
      }
      if (!/^[0-9a-f]{8,64}$/i.test(action.hash)) {
        return fail('INVALID_HASH', 'コミットメントの形式が不正です');
      }
      if (state.wiredCommitment !== null) {
        return fail('ALREADY_SET', 'すでに電気イスを仕掛けています');
      }
      return {
        ok: true,
        state: bump(state, {
          wiredCommitment: action.hash.toLowerCase(),
          phase: 'sit',
        }),
      };
    }

    case 'sit': {
      if (state.phase !== 'sit') {
        return fail('INVALID_PHASE', `sit できないフェーズです: ${state.phase}`);
      }
      const { player } = action;
      if (player !== 0 && player !== 1) {
        return fail('INVALID_PLAYER', 'プレイヤー番号が不正です');
      }
      if (player !== getDefender(state)) {
        return fail('INVALID_PLAYER', '座る椅子を選べるのは守備側だけです');
      }
      if (state.sittingChair !== null) {
        return fail('ALREADY_SEATED', 'すでに座る椅子を選んでいます');
      }
      if (!isChairLegal(state, action.chair)) {
        return fail('INVALID_CHAIR', 'その椅子には座れません');
      }
      return {
        ok: true,
        state: bump(state, {
          sittingChair: action.chair,
          phase: 'press',
        }),
      };
    }

    case 'press': {
      if (state.phase !== 'press') {
        return fail('INVALID_PHASE', `press できないフェーズです: ${state.phase}`);
      }
      const { player } = action;
      if (player !== 0 && player !== 1) {
        return fail('INVALID_PLAYER', 'プレイヤー番号が不正です');
      }
      if (player !== state.attacker) {
        return fail('INVALID_PLAYER', 'ボタンを押せるのは攻撃側だけです');
      }
      const commitment = state.wiredCommitment;
      if (commitment === null) {
        return fail('NOT_READY', '電気イスが仕掛けられていません');
      }
      if (!verifyCommitment(commitment, action.chair, action.salt)) {
        return fail('COMMITMENT_MISMATCH', '仕掛けた椅子と公開された椅子が一致しません');
      }
      if (!isChairLegal(state, action.chair)) {
        return fail('INVALID_CHAIR', 'その椅子には仕掛けられません');
      }
      return { ok: true, state: resolveTurn(state, action.chair) };
    }

    case 'advance': {
      if (state.phase !== 'result') {
        return fail('INVALID_PHASE', `advance できないフェーズです: ${state.phase}`);
      }
      return { ok: true, state: nextTurn(state) };
    }

    case 'forfeit': {
      const { player } = action;
      if (player !== 0 && player !== 1) {
        return fail('INVALID_PLAYER', 'プレイヤー番号が不正です');
      }
      return {
        ok: true,
        state: finish(state, {
          kind: 'win',
          winner: otherPlayer(player),
          reason: 'forfeit',
        }),
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
      },
      {
        id: state.players[1].id,
        name: state.players[1].name,
        points: state.players[1].points,
        shocksDealt: state.players[1].shocksDealt,
      },
    ],
    phase: state.phase,
    turn: state.turn,
    attacker: state.attacker,
    wiredCommitted: state.wiredCommitment !== null,
    sittingChair: state.sittingChair,
    retiredChairs: state.retiredChairs,
    availableChairs: availableChairs(state),
    history: state.history,
    lastResult: state.lastResult,
    outcome: state.outcome,
    revision: state.revision,
    you,
  };
}
