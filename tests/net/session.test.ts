import { afterEach, describe, expect, it } from 'vitest';
import { attachBot } from '@/game/bot';
import { MemoryBus } from '@/net/memory';
import { MatchSession } from '@/net/session';
import type { PlayerIdentity, MatchView } from '@/game/types';

const HOST: PlayerIdentity = { id: 'host', name: 'Host' };
const GUEST: PlayerIdentity = { id: 'guest', name: 'Guest' };
const PLAYERS = [HOST, GUEST] as const;

function flush(rounds = 12): Promise<void> {
  return new Promise((resolve) => {
    let count = 0;
    const step = (): void => {
      count += 1;
      if (count >= rounds) {
        resolve();
        return;
      }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}

interface Harness {
  bus: MemoryBus;
  host: MatchSession;
  guest: MatchSession;
  hostViews: MatchView[];
  guestViews: MatchView[];
  dispose: () => void;
}

function makeHarness(
  options: {
    now?: () => number;
    startingAttacker?: 0 | 1;
    config?: { commitMs?: number; revealMs?: number; resultMs?: number };
  } = {},
): Harness {
  const bus = new MemoryBus();
  const hostTransport = bus.addPeer('host', 'host');
  const guestTransport = bus.addPeer('guest', 'host');
  const hostViews: MatchView[] = [];
  const guestViews: MatchView[] = [];
  const now = options.now ?? (() => 1_000_000);

  const host = new MatchSession({
    transport: hostTransport,
    selfId: 'host',
    players: PLAYERS,
    isHost: true,
    startingAttacker: options.startingAttacker ?? 0,
    timers: false,
    now,
    config: options.config,
  });
  host.on('view', (view) => hostViews.push(view));

  // The guest can be created after the host published; the session sends a
  // hello and the host replies with the latest snapshot.
  const guest = new MatchSession({
    transport: guestTransport,
    selfId: 'guest',
    players: PLAYERS,
    isHost: false,
    timers: false,
    now,
    config: options.config,
  });
  guest.on('view', (view) => guestViews.push(view));

  return {
    bus,
    host,
    guest,
    hostViews,
    guestViews,
    dispose: () => {
      host.dispose();
      guest.dispose();
      hostTransport.close();
      guestTransport.close();
    },
  };
}

describe('MatchSession', () => {
  const harnesses: Harness[] = [];
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.dispose();
  });

  function harness(options: Parameters<typeof makeHarness>[0] = {}): Harness {
    const created = makeHarness(options);
    harnesses.push(created);
    return created;
  }

  it('starts a match on the host and syncs the guest', async () => {
    const h = harness();
    await flush();
    expect(h.host.view?.phase).toBe('commit');
    expect(h.host.view?.turn).toBe(1);
    expect(h.guest.view).not.toBeNull();
    expect(h.guest.view?.matchId).toBe(h.host.view?.matchId);
    expect(h.guest.view?.you).toBe(1);
    expect(h.guest.view?.phase).toBe('commit');
  });

  it('plays a full turn through commit and reveal', async () => {
    const h = harness();
    await flush();

    expect(h.host.view?.attacker).toBe(0);
    expect(h.host.chooseChair(12)).toEqual({ ok: true });
    await flush();
    expect(h.guest.chooseChair(1)).toEqual({ ok: true });
    await flush(20);

    expect(h.host.view?.phase).toBe('result');
    expect(h.guest.view?.phase).toBe('result');
    expect(h.host.view?.lastResult).toMatchObject({
      wiredChair: 12,
      sittingChair: 1,
      hit: false,
    });
    expect(h.guest.view?.players[1].points).toBe(1);
    expect(h.host.view?.players[1].points).toBe(1);
    expect(h.host.view?.retiredChairs).toEqual([1]);
    expect(h.guest.view?.availableChairs).not.toContain(1);
  });

  it('never reveals a choice to the guest before the result', async () => {
    const h = harness();
    await flush();
    h.host.chooseChair(7);
    await flush();
    // The guest can see that the host committed (hash) but not the chair.
    const guestView = h.guest.view;
    expect(guestView?.phase).toBe('commit');
    expect(guestView?.commitments[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(guestView)).not.toContain('wiredChair');
    expect(guestView?.lastResult).toBeNull();
  });

  it('auto-advances after the result deadline', async () => {
    let now = 1_000_000;
    const h = harness({
      now: () => now,
      config: { commitMs: 1_000, revealMs: 1_000, resultMs: 500 },
    });
    await flush();
    h.host.chooseChair(12);
    await flush();
    h.guest.chooseChair(1);
    await flush(20);
    expect(h.host.view?.phase).toBe('result');

    now += 500;
    h.host.tick();
    await flush(20);
    expect(h.host.view?.phase).toBe('commit');
    expect(h.host.view?.turn).toBe(2);
    expect(h.guest.view?.turn).toBe(2);
    expect(h.host.view?.attacker).toBe(1);
  });

  it('forfeits the guest if it misses the commit deadline', async () => {
    let now = 1_000_000;
    const h = harness({
      now: () => now,
      config: { commitMs: 1_000, revealMs: 1_000, resultMs: 1_000 },
    });
    await flush();
    h.host.chooseChair(4);
    await flush();

    // The guest never chooses. The host waits for the deadline.
    now += 1_000;
    h.host.tick();
    await flush(20);
    expect(h.host.view?.phase).toBe('finished');
    expect(h.host.view?.outcome).toEqual({ kind: 'win', winner: 0, reason: 'forfeit' });
    expect(h.guest.view?.outcome).toEqual({ kind: 'win', winner: 0, reason: 'forfeit' });
  });

  it('can rematch after the match is finished', async () => {
    const h = harness();
    await flush();
    h.host.forfeit();
    await flush(20);
    expect(h.host.view?.phase).toBe('finished');

    const oldMatchId = h.host.view?.matchId;
    h.host.rematch();
    h.guest.rematch();
    await flush(30);
    expect(h.host.view?.phase).toBe('commit');
    expect(h.host.view?.matchId).not.toBe(oldMatchId);
    expect(h.guest.view?.matchId).toBe(h.host.view?.matchId);
    expect(h.guest.view?.turn).toBe(1);
    expect(h.guest.view?.players[0].points).toBe(0);

    // The guest's per-turn state must reset even though turn 1 repeats.
    expect(h.guest.chooseChair(5)).toEqual({ ok: true });
    await flush(20);
    expect(h.guest.hasCommittedThisTurn).toBe(true);
    expect(h.host.view?.players[1].committed).toBe(true);
  });

  it('rejects an out-of-turn chair choice', async () => {
    const h = harness();
    await flush();
    h.host.chooseChair(3);
    await flush();
    h.host.chooseChair(4);
    expect(h.host.view?.phase).toBe('commit');
    expect(h.host.hasCommittedThisTurn).toBe(true);
  });

  it('runs a complete bot-vs-bot match', async () => {
    const h = harness({ startingAttacker: 0 });
    await flush();
    const detachGuest = attachBot(h.guest, { delayMs: 0, timers: false, seed: 'bot-g' });
    const detachHost = attachBot(h.host, { delayMs: 0, timers: false, seed: 'bot-h' });

    for (let i = 0; i < 400 && h.host.view?.phase !== 'finished'; i += 1) {
      await flush(4);
      if (h.host.view?.phase === 'result') h.host.advance();
    }
    detachHost();
    detachGuest();

    await flush(20);
    expect(h.host.view?.phase).toBe('finished');
    expect(h.host.view?.outcome).not.toBeNull();
    expect(h.host.view?.history.length).toBeLessThanOrEqual(8);
    expect(h.guest.view?.phase).toBe('finished');
  });
});
