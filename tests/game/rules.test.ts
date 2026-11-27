import { describe, expect, it } from 'vitest';
import { commitmentHash, createSalt, verifyCommitment } from '@/game/rng';
import {
  applyAction,
  availableChairs,
  createMatch,
  createView,
  isChairLegal,
  maxRoundsOfConfig,
  otherPlayer,
  roundOfTurn,
} from '@/game/rules';
import type { ActionResult, MatchState } from '@/game/types';

const PLAYERS = [
  { id: 'p0', name: 'Alice' },
  { id: 'p1', name: 'Bob' },
] as const;

const SALT_A = 'a'.repeat(32);
const SALT_B = 'b'.repeat(32);

function fresh(config: Parameters<typeof createMatch>[0]['config'] = {}): MatchState {
  return createMatch({
    matchId: 'test-match',
    players: PLAYERS,
    startingAttacker: 0,
    config,
  });
}

function must(result: ActionResult): MatchState {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.state;
}

/** セット → 着席 → ボタン を1ターン分実行する。state は set フェーズであること。 */
function playTurn(
  state: MatchState,
  wiredChair: number,
  sittingChair: number,
  salt = SALT_A,
): MatchState {
  const attacker = state.attacker;
  const defender = otherPlayer(attacker);

  let next = must(
    applyAction(state, { type: 'set', player: attacker, hash: commitmentHash(wiredChair, salt) }),
  );
  next = must(applyAction(next, { type: 'sit', player: defender, chair: sittingChair }));
  next = must(applyAction(next, { type: 'press', player: attacker, chair: wiredChair, salt }));
  return next;
}

function advance(state: MatchState): MatchState {
  return must(applyAction(state, { type: 'advance' }));
}

describe('commitments', () => {
  it('is deterministic and salt-dependent', () => {
    const salt = createSalt();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    const hash = commitmentHash(7, salt);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(commitmentHash(7, salt)).toBe(hash);
    expect(commitmentHash(8, salt)).not.toBe(hash);
    expect(verifyCommitment(hash, 7, salt)).toBe(true);
    const otherSalt = `${salt[0] === '0' ? '1' : '0'}${salt.slice(1)}`;
    expect(verifyCommitment(hash, 7, otherSalt)).toBe(false);
  });
});

describe('match setup', () => {
  it('starts in the set phase with a full chair set', () => {
    const state = fresh();
    expect(state.phase).toBe('set');
    expect(state.turn).toBe(1);
    expect(state.attacker).toBe(0);
    expect(state.wiredCommitment).toBeNull();
    expect(state.sittingChair).toBeNull();
    expect(availableChairs(state)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(state.players[0].points).toBe(0);
    expect(state.players[1].points).toBe(0);
  });

  it('honours a requested starting attacker', () => {
    expect(fresh().attacker).toBe(0);
    const again = createMatch({ players: PLAYERS, startingAttacker: 1 });
    expect(again.attacker).toBe(1);
  });
});

describe('turn order', () => {
  it('requires set → sit → press, with the correct actor in each phase', () => {
    let state = fresh();

    const sitTooEarly = applyAction(state, { type: 'sit', player: 1, chair: 12 });
    expect(sitTooEarly.ok).toBe(false);
    if (!sitTooEarly.ok) expect(sitTooEarly.code).toBe('INVALID_PHASE');

    const defenderSets = applyAction(state, {
      type: 'set',
      player: 1,
      hash: commitmentHash(12, SALT_B),
    });
    expect(defenderSets.ok).toBe(false);
    if (!defenderSets.ok) expect(defenderSets.code).toBe('INVALID_PLAYER');

    state = must(applyAction(state, { type: 'set', player: 0, hash: commitmentHash(12, SALT_A) }));
    expect(state.phase).toBe('sit');
    expect(state.wiredCommitment).not.toBeNull();
    expect(state.sittingChair).toBeNull();

    const attackerSits = applyAction(state, { type: 'sit', player: 0, chair: 1 });
    expect(attackerSits.ok).toBe(false);
    if (!attackerSits.ok) expect(attackerSits.code).toBe('INVALID_PLAYER');

    state = must(applyAction(state, { type: 'sit', player: 1, chair: 12 }));
    expect(state.phase).toBe('press');
    expect(state.sittingChair).toBe(12);

    const defenderPresses = applyAction(state, {
      type: 'press',
      player: 1,
      chair: 12,
      salt: SALT_B,
    });
    expect(defenderPresses.ok).toBe(false);
    if (!defenderPresses.ok) expect(defenderPresses.code).toBe('INVALID_PLAYER');

    state = must(applyAction(state, { type: 'press', player: 0, chair: 12, salt: SALT_A }));
    expect(state.phase).toBe('result');
  });

  it('does not expose the wired chair before the button press', () => {
    let state = fresh();
    state = must(applyAction(state, { type: 'set', player: 0, hash: commitmentHash(9, SALT_A) }));
    const afterSet = createView(state, 1);
    expect(afterSet.phase).toBe('sit');
    expect(afterSet.wiredCommitted).toBe(true);
    expect(afterSet.sittingChair).toBeNull();
    expect(afterSet.lastResult).toBeNull();
    expect(JSON.stringify(afterSet)).not.toContain('wiredChair');

    state = must(applyAction(state, { type: 'select', player: 1, chair: 3 }));
    const afterSelect = createView(state, 0);
    expect(afterSelect.previewChair).toBe(3);
    expect(JSON.stringify(afterSelect)).not.toContain('wiredChair');
    expect(JSON.stringify(afterSelect)).not.toContain('"wiredChair":9');

    state = must(applyAction(state, { type: 'sit', player: 1, chair: 3 }));
    const afterSit = createView(state, 1);
    expect(afterSit.phase).toBe('press');
    expect(afterSit.sittingChair).toBe(3);
    expect(afterSit.lastResult).toBeNull();
    expect(JSON.stringify(afterSit)).not.toContain('wiredChair');

    state = must(applyAction(state, { type: 'press', player: 0, chair: 9, salt: SALT_A }));
    const afterPress = createView(state, 1);
    expect(afterPress.lastResult).toMatchObject({ wiredChair: 9, sittingChair: 3, hit: false });
  });

  it('counts two turns per round', () => {
    let state = fresh();

    expect(createView(state, 0).round).toBe(1);
    expect(roundOfTurn(state.turn)).toBe(1);
    expect(maxRoundsOfConfig(state.config)).toBe(8);
    expect(createView(state, 0).maxRounds).toBe(8);

    state = advance(playTurn(state, 1, 2));
    expect(state.turn).toBe(2);
    expect(createView(state, 0).round).toBe(1);
    expect(roundOfTurn(state.turn)).toBe(1);

    state = advance(playTurn(state, 3, 4, SALT_B));
    expect(state.turn).toBe(3);
    expect(createView(state, 0).round).toBe(2);
    expect(roundOfTurn(state.turn)).toBe(2);
  });

  it('allows the defender to preview, update, clear, and confirm a chair', () => {
    let state = must(applyAction(fresh(), {
      type: 'set',
      player: 0,
      hash: commitmentHash(9, SALT_A),
    }));
    state = must(applyAction(state, { type: 'select', player: 1, chair: 5 }));
    expect(state.phase).toBe('sit');
    expect(state.previewChair).toBe(5);
    expect(createView(state, 0).previewChair).toBe(5);

    state = must(applyAction(state, { type: 'select', player: 1, chair: 7 }));
    expect(state.previewChair).toBe(7);
    state = must(applyAction(state, { type: 'select', player: 1, chair: null }));
    expect(state.previewChair).toBeNull();

    state = must(applyAction(state, { type: 'select', player: 1, chair: 5 }));
    state = must(applyAction(state, { type: 'sit', player: 1, chair: 3 }));
    expect(state.previewChair).toBeNull();
    expect(state.phase).toBe('press');
  });

  it('rejects selection by the attacker, in the wrong phase, or of an unavailable chair', () => {
    let state = fresh();
    const beforeSet = applyAction(state, { type: 'select', player: 1, chair: 5 });
    expect(beforeSet.ok).toBe(false);
    if (!beforeSet.ok) expect(beforeSet.code).toBe('INVALID_PHASE');

    state = must(applyAction(state, { type: 'set', player: 0, hash: commitmentHash(9, SALT_A) }));
    const attackerSelects = applyAction(state, { type: 'select', player: 0, chair: 5 });
    expect(attackerSelects.ok).toBe(false);
    if (!attackerSelects.ok) expect(attackerSelects.code).toBe('INVALID_PLAYER');

    const illegalChair = applyAction(state, { type: 'select', player: 1, chair: 13 });
    expect(illegalChair.ok).toBe(false);
    if (!illegalChair.ok) expect(illegalChair.code).toBe('INVALID_CHAIR');

    state = playTurn(fresh(), 9, 12, SALT_A);
    state = advance(state);
    state = must(applyAction(state, { type: 'set', player: 1, hash: commitmentHash(1, SALT_B) }));
    const retiredChair = applyAction(state, { type: 'select', player: 0, chair: 12 });
    expect(retiredChair.ok).toBe(false);
    if (!retiredChair.ok) expect(retiredChair.code).toBe('INVALID_CHAIR');

    state = must(applyAction(state, { type: 'select', player: 0, chair: 5 }));
    state = must(applyAction(state, { type: 'sit', player: 0, chair: 5 }));
    const selectionAfterSit = applyAction(state, { type: 'select', player: 0, chair: 7 });
    expect(selectionAfterSit.ok).toBe(false);
    if (!selectionAfterSit.ok) expect(selectionAfterSit.code).toBe('INVALID_PHASE');
  });
});

describe('turn resolution', () => {
  it('awards the sitting chair number when the chair is avoided', () => {
    const result = playTurn(fresh(), 1, 12);
    expect(result.phase).toBe('result');
    expect(result.players[0].points).toBe(0);
    expect(result.players[1].points).toBe(12);
    expect(result.players[1].shocksDealt).toBe(0);
    expect(result.lastResult).toMatchObject({
      turn: 1,
      attacker: 0,
      defender: 1,
      wiredChair: 1,
      sittingChair: 12,
      hit: false,
      pointsAwarded: 12,
      pointsLost: 0,
      retiredChair: 12,
    });
    expect(result.retiredChairs).toEqual([12]);
    expect(result.outcome).toBeNull();
  });

  it('resets the defender points and keeps the shocked chair available', () => {
    let state = playTurn(fresh(), 1, 12);
    expect(state.players[1].points).toBe(12);
    state = advance(state);
    expect(state.attacker).toBe(1);
    expect(state.turn).toBe(2);

    state = playTurn(state, 5, 5, SALT_B);
    expect(state.players[0].points).toBe(0);
    expect(state.players[1].points).toBe(12);
    expect(state.players[1].shocksDealt).toBe(1);
    expect(state.lastResult).toMatchObject({
      hit: true,
      pointsAwarded: 0,
      pointsLost: 0,
      retiredChair: null,
    });
    expect(state.retiredChairs).toEqual([12]);
    expect(isChairLegal(state, 5)).toBe(true);
  });

  it('removes points that were already earned from the shocked player', () => {
    let state = playTurn(fresh(), 1, 12); // Bob 12
    state = advance(state);
    state = playTurn(state, 2, 11, SALT_B); // Alice 11
    state = advance(state);
    state = playTurn(state, 3, 10, SALT_A); // Bob 22
    state = advance(state);
    state = playTurn(state, 2, 2, SALT_B); // Alice shocked -> 0, Bob 22
    expect(state.players[0].points).toBe(0);
    expect(state.players[1].points).toBe(22);
    expect(state.lastResult?.pointsLost).toBe(11);
  });

  it('retired chairs cannot be selected again', () => {
    let state = playTurn(fresh(), 1, 12);
    expect(isChairLegal(state, 12)).toBe(false);
    state = advance(state);

    state = must(applyAction(state, { type: 'set', player: 1, hash: commitmentHash(12, SALT_B) }));
    const rejectedSit = applyAction(state, { type: 'sit', player: 0, chair: 12 });
    expect(rejectedSit.ok).toBe(false);
    if (!rejectedSit.ok) expect(rejectedSit.code).toBe('INVALID_CHAIR');

    state = must(applyAction(state, { type: 'sit', player: 0, chair: 1 }));
    const rejectedPress = applyAction(state, { type: 'press', player: 1, chair: 12, salt: SALT_B });
    expect(rejectedPress.ok).toBe(false);
    if (!rejectedPress.ok) expect(rejectedPress.code).toBe('INVALID_CHAIR');
  });
});

describe('validation', () => {
  it('rejects a press that does not match the commitment', () => {
    let state = fresh();
    state = must(applyAction(state, { type: 'set', player: 0, hash: commitmentHash(5, SALT_A) }));
    state = must(applyAction(state, { type: 'sit', player: 1, chair: 6 }));
    const result = applyAction(state, { type: 'press', player: 0, chair: 6, salt: SALT_A });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('COMMITMENT_MISMATCH');
  });

  it('rejects a malformed commitment and duplicate phases', () => {
    const malformed = applyAction(fresh(), { type: 'set', player: 0, hash: 'nope' });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.code).toBe('INVALID_HASH');

    let state = must(
      applyAction(fresh(), { type: 'set', player: 0, hash: commitmentHash(5, SALT_A) }),
    );
    const wrongPhase = applyAction(state, {
      type: 'set',
      player: 0,
      hash: commitmentHash(6, SALT_A),
    });
    expect(wrongPhase.ok).toBe(false);
    if (!wrongPhase.ok) expect(wrongPhase.code).toBe('INVALID_PHASE');

    state = must(applyAction(state, { type: 'sit', player: 1, chair: 6 }));
    const pressWithBadSalt = applyAction(state, {
      type: 'press',
      player: 0,
      chair: 5,
      salt: SALT_B,
    });
    expect(pressWithBadSalt.ok).toBe(false);
    if (!pressWithBadSalt.ok) expect(pressWithBadSalt.code).toBe('COMMITMENT_MISMATCH');
  });

  it('does not mutate the previous state', () => {
    const state = fresh();
    const before = JSON.stringify(state);
    playTurn(state, 1, 12);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('victory conditions', () => {
  it('wins at 40 points', () => {
    let state = fresh();
    const turns: Array<[number, number]> = [
      [1, 12],
      [2, 1],
      [3, 11],
      [4, 2],
      [5, 10],
      [6, 3],
      [7, 9],
    ];
    for (let i = 0; i < turns.length; i += 1) {
      const [wired, sitting] = turns[i]!;
      state = playTurn(state, wired, sitting, `salt-${i}`);
      if (state.outcome) break;
      state = advance(state);
    }
    expect(state.players[1].points).toBe(42);
    expect(state.phase).toBe('result');
    expect(state.outcome).toEqual({ kind: 'win', winner: 1, reason: 'points' });
    expect(state.turn).toBe(7);
    state = advance(state);
    expect(state.phase).toBe('finished');
    expect(state.outcome?.winner).toBe(1);
  });

  it('wins after shocking the opponent three times', () => {
    let state = fresh();
    for (let turn = 1; turn <= 5; turn += 1) {
      state = playTurn(state, 5, 5, `salt-${turn}`);
      if (state.outcome) break;
      state = advance(state);
    }
    expect(state.players[0].shocksDealt).toBe(3);
    expect(state.outcome).toEqual({ kind: 'win', winner: 0, reason: 'shocks' });
    expect(state.turn).toBe(5);
  });

  it('decides by points after the turn limit', () => {
    let state = fresh({ maxTurns: 2 });
    state = playTurn(state, 1, 12);
    expect(state.outcome).toBeNull();
    state = advance(state);
    state = playTurn(state, 1, 11, SALT_B);
    expect(state.outcome).toEqual({ kind: 'win', winner: 1, reason: 'turn-limit' });
  });

  it('draws a tied match after the turn limit', () => {
    let state = fresh({ maxTurns: 2 });
    state = playTurn(state, 5, 5);
    state = advance(state);
    state = playTurn(state, 6, 6, SALT_B);
    expect(state.players[0].points).toBe(0);
    expect(state.players[1].points).toBe(0);
    expect(state.outcome).toEqual({ kind: 'draw', winner: null, reason: 'draw' });
  });
});

describe('forfeits', () => {
  it('allows a player to forfeit explicitly', () => {
    const state = must(applyAction(fresh(), { type: 'forfeit', player: 0 }));
    expect(state.phase).toBe('finished');
    expect(state.outcome).toEqual({ kind: 'win', winner: 1, reason: 'forfeit' });
  });

  it('waits for the result advance instead of advancing automatically', () => {
    const state = playTurn(fresh(), 1, 12);
    expect(state.phase).toBe('result');
    expect(state.turn).toBe(1);

    const next = advance(state);
    expect(next.phase).toBe('set');
    expect(next.turn).toBe(2);
    expect(next.attacker).toBe(1);
    expect(next.wiredCommitment).toBeNull();
    expect(next.sittingChair).toBeNull();
  });
});

describe('views', () => {
  it('gives each viewer their own index', () => {
    const state = fresh();
    expect(createView(state, 0).you).toBe(0);
    expect(createView(state, 1).you).toBe(1);
  });

  it('computes available chairs from the retired list', () => {
    const state = playTurn(fresh(), 1, 12);
    expect(availableChairs(state)).not.toContain(12);
    expect(availableChairs(state)).toHaveLength(11);
    expect(createView(state, 0).availableChairs).toHaveLength(11);
  });
});

describe('full sequence', () => {
  it('keeps chairs unique across a whole match', () => {
    let state = fresh();
    for (let turn = 0; turn < 8 && !state.outcome; turn += 1) {
      const rows = availableChairs(state);
      const wired = rows[(turn * 3 + 1) % rows.length]!;
      const sitting = rows[(turn * 5 + 2) % rows.length]!;
      state = playTurn(state, wired, sitting, `seq-${turn}`);
      const retired = state.retiredChairs;
      expect(new Set(retired).size).toBe(retired.length);
      if (!state.outcome) state = advance(state);
    }
    expect(state.history.length).toBeLessThanOrEqual(8);
  });
});
