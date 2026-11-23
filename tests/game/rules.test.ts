import { describe, expect, it } from 'vitest';
import { commitmentHash, createSalt, verifyCommitment } from '@/game/rng';
import {
  applyAction,
  availableChairs,
  createMatch,
  createView,
  isChairLegal,
  otherPlayer,
} from '@/game/rules';
import type { ActionResult, MatchState } from '@/game/types';

const PLAYERS = [
  { id: 'p0', name: 'Alice' },
  { id: 'p1', name: 'Bob' },
] as const;

const SALT_A = 'a'.repeat(32);
const SALT_B = 'b'.repeat(32);
const NOW = 1_700_000_000_000;

function fresh(config: Parameters<typeof createMatch>[0]['config'] = {}): MatchState {
  return createMatch({
    matchId: 'test-match',
    players: PLAYERS,
    startingAttacker: 0,
    config: { commitMs: 30_000, revealMs: 15_000, resultMs: 7_000, ...config },
    now: NOW,
  });
}

function must(result: ActionResult): MatchState {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.state;
}

/** 両者の commit と reveal を一気に行う。state は commit フェーズであること。 */
function playTurn(
  state: MatchState,
  attackerChair: number,
  defenderChair: number,
  now = NOW,
): MatchState {
  const attacker = state.attacker;
  const defender = otherPlayer(attacker);
  let next = must(
    applyAction(
      state,
      { type: 'commit', player: attacker, hash: commitmentHash(attackerChair, SALT_A) },
      now,
    ),
  );
  next = must(
    applyAction(
      next,
      { type: 'commit', player: defender, hash: commitmentHash(defenderChair, SALT_B) },
      now,
    ),
  );
  next = must(
    applyAction(
      next,
      { type: 'reveal', player: attacker, chair: attackerChair, salt: SALT_A },
      now,
    ),
  );
  next = must(
    applyAction(
      next,
      { type: 'reveal', player: defender, chair: defenderChair, salt: SALT_B },
      now,
    ),
  );
  return next;
}

function advance(state: MatchState, now = NOW): MatchState {
  return must(applyAction(state, { type: 'advance' }, now));
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
    expect(verifyCommitment(hash, 7, `${salt.slice(0, -1)}0`)).toBe(false);
  });
});

describe('match setup', () => {
  it('starts in commit phase with a full chair set', () => {
    const state = fresh();
    expect(state.phase).toBe('commit');
    expect(state.turn).toBe(1);
    expect(state.attacker).toBe(0);
    expect(availableChairs(state)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(state.players[0].points).toBe(0);
    expect(state.players[1].points).toBe(0);
    expect(state.deadline).toBe(NOW + 30_000);
  });

  it('honours a requested starting attacker', () => {
    const state = fresh({});
    expect(state.attacker).toBe(0);
    const again = createMatch({
      players: PLAYERS,
      startingAttacker: 1,
      now: NOW,
    });
    expect(again.attacker).toBe(1);
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

    state = playTurn(state, 5, 5);
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
    state = playTurn(state, 2, 11); // Alice 11
    state = advance(state);
    state = playTurn(state, 3, 10); // Bob 22
    state = advance(state);
    state = playTurn(state, 2, 2); // Alice shocked -> 0, Bob still 22
    expect(state.players[0].points).toBe(0);
    expect(state.players[1].points).toBe(22);
    expect(state.lastResult?.pointsLost).toBe(11);
  });

  it('retired chairs cannot be selected again', () => {
    let state = playTurn(fresh(), 1, 12);
    expect(isChairLegal(state, 12)).toBe(false);
    state = advance(state);

    const salt = 'c'.repeat(32);
    let next = must(
      applyAction(state, { type: 'commit', player: 0, hash: commitmentHash(12, salt) }, NOW),
    );
    next = must(
      applyAction(next, { type: 'commit', player: 1, hash: commitmentHash(1, SALT_B) }, NOW),
    );
    const rejected = applyAction(next, { type: 'reveal', player: 0, chair: 12, salt }, NOW);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('INVALID_CHAIR');
  });
});

describe('validation', () => {
  it('rejects a reveal that does not match the commitment', () => {
    let state = fresh();
    state = must(
      applyAction(state, { type: 'commit', player: 0, hash: commitmentHash(5, SALT_A) }, NOW),
    );
    state = must(
      applyAction(state, { type: 'commit', player: 1, hash: commitmentHash(6, SALT_B) }, NOW),
    );
    const result = applyAction(state, { type: 'reveal', player: 0, chair: 6, salt: SALT_A }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('COMMITMENT_MISMATCH');
  });

  it('rejects duplicate commits and out-of-phase actions', () => {
    let state = fresh();
    state = must(
      applyAction(state, { type: 'commit', player: 0, hash: commitmentHash(5, SALT_A) }, NOW),
    );
    const duplicate = applyAction(
      state,
      { type: 'commit', player: 0, hash: commitmentHash(6, SALT_A) },
      NOW,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe('ALREADY_COMMITTED');

    const wrongPhase = applyAction(
      state,
      { type: 'reveal', player: 1, chair: 6, salt: SALT_B },
      NOW,
    );
    expect(wrongPhase.ok).toBe(false);
    if (!wrongPhase.ok) expect(wrongPhase.code).toBe('INVALID_PHASE');
  });

  it('does not mutate the previous state', () => {
    const state = fresh();
    const before = JSON.stringify(state);
    playTurn(state, 1, 12);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('hidden information', () => {
  it('does not expose either chair before the result', () => {
    let state = fresh();
    state = must(
      applyAction(state, { type: 'commit', player: 0, hash: commitmentHash(9, SALT_A) }, NOW),
    );
    state = must(
      applyAction(state, { type: 'commit', player: 1, hash: commitmentHash(3, SALT_B) }, NOW),
    );
    state = must(applyAction(state, { type: 'reveal', player: 0, chair: 9, salt: SALT_A }, NOW));
    const view = createView(state, 1);
    expect(view.phase).toBe('reveal');
    expect(view.lastResult).toBeNull();
    expect(view.players[0].revealed).toBe(true);
    expect(view.players[1].revealed).toBe(false);
    expect(JSON.stringify(view)).not.toContain('wiredChair');
    expect(JSON.stringify(view)).not.toContain('sittingChair');
    expect('reveals' in view).toBe(false);
  });

  it('publishes both choices once the result is reached', () => {
    let state = fresh();
    state = must(
      applyAction(state, { type: 'commit', player: 0, hash: commitmentHash(9, SALT_A) }, NOW),
    );
    state = must(
      applyAction(state, { type: 'commit', player: 1, hash: commitmentHash(3, SALT_B) }, NOW),
    );
    state = must(applyAction(state, { type: 'reveal', player: 0, chair: 9, salt: SALT_A }, NOW));
    state = must(applyAction(state, { type: 'reveal', player: 1, chair: 3, salt: SALT_B }, NOW));
    const view = createView(state, 0);
    expect(view.lastResult).toMatchObject({ wiredChair: 9, sittingChair: 3, hit: false });
  });
});

describe('victory conditions', () => {
  it('wins at 40 points', () => {
    let state = fresh();
    const turns: Array<[number, number]> = [
      [1, 12], // Bob 12
      [2, 1], // Alice 1
      [3, 11], // Bob 23
      [4, 2], // Alice 3
      [5, 10], // Bob 33
      [6, 3], // Alice 6
      [7, 9], // Bob 42 -> win
    ];
    for (let i = 0; i < turns.length; i += 1) {
      const [wired, sitting] = turns[i]!;
      state = playTurn(state, wired, sitting);
      if (state.outcome) break;
      state = advance(state);
    }
    expect(state.players[1].points).toBe(42);
    expect(state.phase).toBe('result');
    expect(state.outcome).toEqual({ kind: 'win', winner: 1, reason: 'points' });
    expect(state.turn).toBe(7);
    // finish まで進めると finished になる
    state = advance(state);
    expect(state.phase).toBe('finished');
    expect(state.outcome?.winner).toBe(1);
  });

  it('wins after shocking the opponent three times', () => {
    let state = fresh();
    for (let turn = 1; turn <= 5; turn += 1) {
      state = playTurn(state, 5, 5);
      if (state.outcome) break;
      state = advance(state);
    }
    expect(state.players[0].shocksDealt).toBe(3);
    expect(state.outcome).toEqual({ kind: 'win', winner: 0, reason: 'shocks' });
    expect(state.turn).toBe(5);
  });

  it('decides by points after the turn limit', () => {
    let state = fresh({ maxTurns: 2 });
    state = playTurn(state, 1, 12); // Bob +12
    expect(state.outcome).toBeNull();
    state = advance(state);
    state = playTurn(state, 1, 11); // Alice +11
    expect(state.outcome).toEqual({ kind: 'win', winner: 1, reason: 'turn-limit' });
  });

  it('draws a tied match after the turn limit', () => {
    let state = fresh({ maxTurns: 2 });
    state = playTurn(state, 5, 5); // Bob shocked
    state = advance(state);
    state = playTurn(state, 6, 6); // Alice shocked
    expect(state.players[0].points).toBe(0);
    expect(state.players[1].points).toBe(0);
    expect(state.outcome).toEqual({ kind: 'draw', winner: null, reason: 'draw' });
  });
});

describe('timeouts and forfeits', () => {
  it('forfeits a player who misses the commit deadline', () => {
    let state = fresh();
    state = must(
      applyAction(state, { type: 'commit', player: 0, hash: commitmentHash(4, SALT_A) }, NOW),
    );
    state = must(applyAction(state, { type: 'timeout' }, NOW + 30_000));
    expect(state.phase).toBe('finished');
    expect(state.outcome).toEqual({ kind: 'win', winner: 0, reason: 'forfeit' });
  });

  it('draws when both players miss the commit deadline', () => {
    const state = must(applyAction(fresh(), { type: 'timeout' }, NOW + 30_000));
    expect(state.outcome).toEqual({ kind: 'draw', winner: null, reason: 'abandoned' });
  });

  it('forfeits a player who commits but fails to reveal', () => {
    let state = fresh();
    state = must(
      applyAction(state, { type: 'commit', player: 0, hash: commitmentHash(5, SALT_A) }, NOW),
    );
    state = must(
      applyAction(state, { type: 'commit', player: 1, hash: commitmentHash(6, SALT_B) }, NOW),
    );
    state = must(applyAction(state, { type: 'reveal', player: 0, chair: 5, salt: SALT_A }, NOW));
    state = must(applyAction(state, { type: 'timeout' }, NOW + 45_000));
    expect(state.phase).toBe('finished');
    expect(state.outcome).toEqual({ kind: 'win', winner: 0, reason: 'forfeit' });
  });

  it('draws when both players fail to reveal', () => {
    let state = fresh();
    state = must(
      applyAction(state, { type: 'commit', player: 0, hash: commitmentHash(4, SALT_A) }, NOW),
    );
    state = must(
      applyAction(state, { type: 'commit', player: 1, hash: commitmentHash(6, SALT_B) }, NOW),
    );
    state = must(applyAction(state, { type: 'timeout' }, NOW + 45_000));
    expect(state.outcome).toEqual({ kind: 'draw', winner: null, reason: 'abandoned' });
  });

  it('allows a player to forfeit explicitly', () => {
    const state = fresh();
    const result = must(applyAction(state, { type: 'forfeit', player: 0 }, NOW));
    expect(result.phase).toBe('finished');
    expect(result.outcome).toEqual({ kind: 'win', winner: 1, reason: 'forfeit' });
  });

  it('advances automatically from the result phase on timeout', () => {
    let state = playTurn(fresh(), 1, 12);
    state = must(applyAction(state, { type: 'timeout' }, NOW + 7_000));
    expect(state.phase).toBe('commit');
    expect(state.turn).toBe(2);
    expect(state.attacker).toBe(1);
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

describe('full random-ish sequence', () => {
  it('keeps the invariant that chairs retire at most once', () => {
    let state = fresh();
    for (let turn = 0; turn < 8 && !state.outcome; turn += 1) {
      const attacker = state.attacker;
      const defender = otherPlayer(attacker);
      const chairs = availableChairs(state);
      const wired = chairs[(turn * 3 + 1) % chairs.length]!;
      const sitting = chairs[(turn * 5 + 2) % chairs.length]!;
      state = playTurn(state, wired, sitting);
      const retired = state.retiredChairs;
      expect(new Set(retired).size).toBe(retired.length);
      if (!state.outcome) state = advance(state);
      void defender;
    }
    expect(state.history.length).toBeLessThanOrEqual(8);
  });
});
