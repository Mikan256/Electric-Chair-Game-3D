#!/usr/bin/env node
/**
 * Headless rules simulation. Runs bot-vs-bot matches without any browser,
 * three.js or networking so balance and invariants can be checked quickly.
 *
 *   pnpm simulate --matches 1000 --seed 1
 */
import { commitmentHash, createRng } from '../src/game/rng';
import { applyAction, availableChairs, createMatch, otherPlayer } from '../src/game/rules';
import type { MatchOutcome, MatchState, PlayerIndex } from '../src/game/types';

interface Args {
  matches: number;
  seed: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  let matches = 1000;
  let seed = '1';
  let verbose = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--matches' || arg === '-n') {
      matches = Math.max(1, Number(argv[i + 1] ?? matches));
      i += 1;
    } else if (arg === '--seed' || arg === '-s') {
      seed = argv[i + 1] ?? seed;
      i += 1;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    }
  }
  return { matches, seed, verbose };
}

interface Stats {
  winsByReason: Record<string, number>;
  winsBySeat: [number, number];
  turns: number;
  maxPoints: number;
  hits: number;
  retiredChairs: number;
  chairWins: Map<number, number>;
}

interface SimulationResult {
  state: MatchState;
  outcome: MatchOutcome;
  turns: number;
  hits: number;
}

function choose(rng: () => number, chairs: number[]): number {
  return chairs[Math.floor(rng() * chairs.length)]!;
}

export function simulateMatch(seed: string): SimulationResult {
  const rng = createRng(seed);
  let state = createMatch({
    matchId: seed,
    players: [
      { id: 'bot-a', name: 'Bot A' },
      { id: 'bot-b', name: 'Bot B' },
    ],
    startingAttacker: (rng() < 0.5 ? 0 : 1) as PlayerIndex,
    seed,
  });

  let hits = 0;
  let guard = 0;
  while (!state.outcome && guard < 32) {
    guard += 1;
    const chairs = availableChairs(state);
    const attacker = state.attacker;
    const defender = otherPlayer(attacker);
    const attackerChair = choose(rng, chairs);
    const defenderChair = choose(rng, chairs);
    const attackerSalt = `${seed}:${state.turn}:${attacker}`;
    const defenderSalt = `${seed}:${state.turn}:${defender}`;
    const now = 1_700_000_000_000 + guard * 60_000;

    const aCommit = applyAction(
      state,
      { type: 'commit', player: attacker, hash: commitmentHash(attackerChair, attackerSalt) },
      now,
    );
    if (!aCommit.ok) throw new Error(`attacker commit failed: ${aCommit.code}`);
    state = aCommit.state;

    const dCommit = applyAction(
      state,
      { type: 'commit', player: defender, hash: commitmentHash(defenderChair, defenderSalt) },
      now,
    );
    if (!dCommit.ok) throw new Error(`defender commit failed: ${dCommit.code}`);
    state = dCommit.state;

    const aReveal = applyAction(
      state,
      { type: 'reveal', player: attacker, chair: attackerChair, salt: attackerSalt },
      now,
    );
    if (!aReveal.ok) throw new Error(`attacker reveal failed: ${aReveal.code}`);
    state = aReveal.state;

    const dReveal = applyAction(
      state,
      { type: 'reveal', player: defender, chair: defenderChair, salt: defenderSalt },
      now,
    );
    if (!dReveal.ok) throw new Error(`defender reveal failed: ${dReveal.code}`);
    state = dReveal.state;

    if (state.lastResult?.hit) hits += 1;
    if (!state.outcome) {
      const advance = applyAction(state, { type: 'advance' }, now);
      if (!advance.ok) throw new Error(`advance failed: ${advance.code}`);
      state = advance.state;
    }
  }

  assertInvariants(state);
  if (!state.outcome) throw new Error('match did not finish');
  return {
    state,
    outcome: state.outcome,
    turns: state.history.length,
    hits,
  };
}

function assertInvariants(state: MatchState): void {
  if (new Set(state.retiredChairs).size !== state.retiredChairs.length) {
    throw new Error('duplicate retired chair');
  }
  for (const chair of state.retiredChairs) {
    if (chair < 1 || chair > state.config.chairCount) throw new Error(`bad chair ${chair}`);
  }
  if (state.history.length > state.config.maxTurns) throw new Error('too many turns');
  for (const player of state.players) {
    if (player.points < 0) throw new Error('negative points');
    if (player.shocksDealt < 0 || player.shocksDealt > state.config.shocksToWin) {
      throw new Error('bad shock count');
    }
  }
  for (const result of state.history) {
    if (result.wiredChair < 1 || result.wiredChair > state.config.chairCount) {
      throw new Error('bad wired chair in history');
    }
    if (result.sittingChair < 1 || result.sittingChair > state.config.chairCount) {
      throw new Error('bad sitting chair in history');
    }
    if (!result.hit && result.pointsAwarded !== result.sittingChair) {
      throw new Error('award does not match chair');
    }
  }
  if (state.outcome && state.outcome.kind === 'win' && state.outcome.winner === null) {
    throw new Error('win without winner');
  }
}

function main(): void {
  const { matches, seed, verbose } = parseArgs(process.argv.slice(2));
  const stats: Stats = {
    winsByReason: {},
    winsBySeat: [0, 0],
    turns: 0,
    maxPoints: 0,
    hits: 0,
    retiredChairs: 0,
    chairWins: new Map(),
  };

  const started = Date.now();
  for (let i = 0; i < matches; i += 1) {
    const matchSeed = `${seed}:${i}`;
    const result = simulateMatch(matchSeed);
    stats.winsByReason[result.outcome.reason] =
      (stats.winsByReason[result.outcome.reason] ?? 0) + 1;
    if (result.outcome.winner !== null) {
      stats.winsBySeat[result.outcome.winner] += 1;
      const winnerPoints = result.state.players[result.outcome.winner].points;
      stats.chairWins.set(winnerPoints, (stats.chairWins.get(winnerPoints) ?? 0) + 1);
      stats.maxPoints = Math.max(stats.maxPoints, winnerPoints);
    }
    stats.turns += result.turns;
    stats.hits += result.hits;
    stats.retiredChairs += result.state.retiredChairs.length;
    if (verbose) {
      console.log(
        `${matchSeed}: ${result.outcome.kind} ${result.outcome.reason} winner=${result.outcome.winner} turns=${result.turns} points=${result.state.players.map((p) => p.points).join('/')}`,
      );
    }
  }

  const elapsed = Date.now() - started;
  console.log(`\n電気椅子ゲーム simulation`);
  console.log(`  matches          : ${matches}`);
  console.log(`  seed             : ${seed}`);
  console.log(`  elapsed          : ${elapsed} ms`);
  console.log(`  avg turns        : ${(stats.turns / matches).toFixed(2)}`);
  console.log(`  avg hits         : ${(stats.hits / matches).toFixed(2)}`);
  console.log(`  avg retired      : ${(stats.retiredChairs / matches).toFixed(2)}`);
  console.log(`  max winner points: ${stats.maxPoints}`);
  console.log(`  wins by reason   :`, stats.winsByReason);
  console.log(`  wins by seat     :`, stats.winsBySeat);
}

main();
