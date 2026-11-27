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

function makeHarness(options: { startingAttacker?: 0 | 1 } = {}): Harness {
  const bus = new MemoryBus();
  const hostTransport = bus.addPeer('host', 'host');
  const guestTransport = bus.addPeer('guest', 'host');
  const hostViews: MatchView[] = [];
  const guestViews: MatchView[] = [];

  const host = new MatchSession({
    transport: hostTransport,
    selfId: 'host',
    players: PLAYERS,
    isHost: true,
    startingAttacker: options.startingAttacker ?? 0,
    timers: false,
  });
  host.on('view', (view) => hostViews.push(view));

  const guest = new MatchSession({
    transport: guestTransport,
    selfId: 'guest',
    players: PLAYERS,
    isHost: false,
    timers: false,
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
    expect(h.host.view?.phase).toBe('set');
    expect(h.host.view?.turn).toBe(1);
    expect(h.host.view?.attacker).toBe(0);
    expect(h.guest.view).not.toBeNull();
    expect(h.guest.view?.matchId).toBe(h.host.view?.matchId);
    expect(h.guest.view?.you).toBe(1);
    expect(h.guest.view?.phase).toBe('set');
  });

  it('plays set → sit → press and applies the chair score', async () => {
    const h = harness();
    await flush();

    expect(h.host.chooseChair(12)).toEqual({ ok: true });
    await flush();
    expect(h.guest.view?.phase).toBe('sit');
    expect(h.guest.view?.wiredCommitted).toBe(true);
    expect(h.guest.view?.sittingChair).toBeNull();

    expect(h.guest.chooseChair(1)).toEqual({ ok: true });
    await flush(20);
    expect(h.guest.view?.phase).toBe('press');
    expect(h.guest.view?.sittingChair).toBe(1);
    expect(h.guest.view?.lastResult).toBeNull();

    expect(h.host.pressButton()).toEqual({ ok: true });
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

  it('keeps the wired chair hidden until the button press', async () => {
    const h = harness();
    await flush();
    h.host.chooseChair(7);
    await flush();
    const afterSet = h.guest.view;
    expect(afterSet?.phase).toBe('sit');
    expect(afterSet?.wiredCommitted).toBe(true);
    expect(afterSet?.sittingChair).toBeNull();
    expect(JSON.stringify(afterSet)).not.toContain('wiredChair');
    expect(afterSet?.lastResult).toBeNull();
  });

  it('supports a guest attacker pressing the button', async () => {
    const h = harness({ startingAttacker: 1 });
    await flush();
    expect(h.guest.view?.attacker).toBe(1);

    expect(h.guest.chooseChair(9)).toEqual({ ok: true });
    await flush();
    expect(h.host.view?.phase).toBe('sit');
    expect(h.host.chooseChair(4)).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.phase).toBe('press');
    expect(h.guest.pressButton()).toEqual({ ok: true });
    await flush(20);

    expect(h.host.view?.phase).toBe('result');
    expect(h.host.view?.lastResult).toMatchObject({ wiredChair: 9, sittingChair: 4 });
  });

  it('waits in the result phase until a player advances', async () => {
    const h = harness();
    await flush();
    h.host.chooseChair(12);
    await flush();
    h.guest.chooseChair(1);
    await flush(20);
    h.host.pressButton();
    await flush(20);
    expect(h.host.view?.phase).toBe('result');

    await flush(40);
    expect(h.host.view?.phase).toBe('result');
    expect(h.guest.view?.phase).toBe('result');

    h.host.advance();
    await flush(20);
    expect(h.host.view?.phase).toBe('set');
    expect(h.host.view?.turn).toBe(2);
    expect(h.guest.view?.turn).toBe(2);
    expect(h.host.view?.attacker).toBe(1);
    expect(h.host.view?.sittingChair).toBeNull();
  });

  it('never forfeits a player for waiting in set, sit, or press', async () => {
    const h = harness();
    await flush();
    expect(h.host.view?.phase).toBe('set');
    await flush(40);
    expect(h.host.view?.phase).toBe('set');

    h.host.chooseChair(4);
    await flush();
    expect(h.guest.view?.phase).toBe('sit');
    await flush(40);
    expect(h.host.view?.phase).toBe('sit');

    h.guest.chooseChair(8);
    await flush(20);
    expect(h.host.view?.phase).toBe('press');
    await flush(40);
    expect(h.host.view?.phase).toBe('press');
    expect(h.host.view?.outcome).toBeNull();
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
    expect(h.host.view?.phase).toBe('set');
    expect(h.host.view?.matchId).not.toBe(oldMatchId);
    expect(h.guest.view?.matchId).toBe(h.host.view?.matchId);
    expect(h.guest.view?.turn).toBe(1);
    expect(h.guest.view?.players[0].points).toBe(0);

    // Turn 1 repeats, but the guest can sit again in the new match.
    expect(h.host.chooseChair(5)).toEqual({ ok: true });
    await flush();
    expect(h.guest.chooseChair(6)).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.phase).toBe('press');
    expect(h.guest.view?.sittingChair).toBe(6);
  });

  it('rejects an out-of-turn chair choice', async () => {
    const h = harness();
    await flush();
    h.host.chooseChair(3);
    await flush();
    expect(h.guest.chooseChair(4)).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.phase).toBe('press');
    const lateChoice = h.guest.chooseChair(5);
    expect(lateChoice.ok).toBe(false);
  });

  it('preview chair is shared with the attacker before confirmation', async () => {
    const h = harness();
    await flush();

    expect(h.host.chooseChair(12)).toEqual({ ok: true });
    await flush();
    expect(h.guest.view?.phase).toBe('sit');

    expect(h.guest.selectChair(5)).toEqual({ ok: true });
    await flush(20);
    for (const view of [h.host.view, h.guest.view]) {
      expect(view?.phase).toBe('sit');
      expect(view?.previewChair).toBe(5);
      expect(view?.sittingChair).toBeNull();
    }
    // 攻撃側（host）の自分のビューにも仮選択が見える。
    expect(h.host.view?.attacker).toBe(0);
    expect(h.host.view?.previewChair).toBe(5);

    expect(h.guest.selectChair(7)).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.previewChair).toBe(7);
    expect(h.guest.view?.previewChair).toBe(7);

    expect(h.guest.selectChair(null)).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.previewChair).toBeNull();
    expect(h.guest.view?.previewChair).toBeNull();

    expect(h.guest.selectChair(5)).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.previewChair).toBe(5);

    expect(h.guest.chooseChair(3)).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.phase).toBe('press');
    expect(h.guest.view?.phase).toBe('press');
    expect(h.host.view?.sittingChair).toBe(3);
    expect(h.guest.view?.sittingChair).toBe(3);
    expect(h.host.view?.previewChair).toBeNull();
    expect(h.guest.view?.previewChair).toBeNull();

    const attackerView = h.host.view;
    expect(JSON.stringify(attackerView)).not.toContain('wiredChair');
    expect(attackerView?.lastResult).toBeNull();
  });

  it('attacker cannot select and out-of-phase select is rejected', async () => {
    // set フェーズでは守備側でも select できない。
    const early = harness();
    await flush();
    expect(early.guest.selectChair(4)).toMatchObject({
      ok: false,
      code: 'INVALID_PHASE',
    });

    const h = harness();
    await flush();
    expect(h.host.chooseChair(12)).toEqual({ ok: true });
    await flush();
    expect(h.guest.view?.phase).toBe('sit');

    expect(h.host.selectChair(4)).toMatchObject({
      ok: false,
      code: 'INVALID_PLAYER',
    });

    expect(h.guest.selectChair(13)).toMatchObject({
      ok: false,
      code: 'INVALID_CHAIR',
    });
  });

  it('round counts both attacks as one round', async () => {
    const h = harness();
    await flush();
    expect(h.host.view?.round).toBe(1);
    expect(h.host.view?.maxRounds).toBe(8);
    expect(h.guest.view?.round).toBe(1);

    // 1 ターン目（攻撃: host / 守備: guest）
    expect(h.host.chooseChair(12)).toEqual({ ok: true });
    await flush();
    expect(h.guest.chooseChair(1)).toEqual({ ok: true });
    await flush(20);
    expect(h.host.pressButton()).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.phase).toBe('result');
    h.host.advance();
    await flush(20);
    expect(h.host.view?.turn).toBe(2);
    expect(h.host.view?.round).toBe(1);
    expect(h.guest.view?.round).toBe(1);

    // 2 ターン目（攻撃: guest / 守備: host）でラウンドが進む。
    expect(h.guest.chooseChair(9)).toEqual({ ok: true });
    await flush();
    expect(h.host.chooseChair(4)).toEqual({ ok: true });
    await flush(20);
    expect(h.guest.pressButton()).toEqual({ ok: true });
    await flush(20);
    expect(h.host.view?.phase).toBe('result');
    h.host.advance();
    await flush(20);
    expect(h.host.view?.turn).toBe(3);
    expect(h.host.view?.round).toBe(2);
    expect(h.guest.view?.round).toBe(2);
  });

  it('runs a complete bot-vs-bot match', async () => {
    const h = harness({ startingAttacker: 0 });
    await flush();
    const detachGuest = attachBot(h.guest, { delayMs: 0, timers: false, seed: 'bot-g' });
    const detachHost = attachBot(h.host, { delayMs: 0, timers: false, seed: 'bot-h' });

    for (let i = 0; i < 600 && h.host.view?.phase !== 'finished'; i += 1) {
      await flush(4);
      if (h.host.view?.phase === 'result') h.host.advance();
    }
    detachHost();
    detachGuest();

    await flush(20);
    expect(h.host.view?.phase).toBe('finished');
    expect(h.host.view?.outcome).not.toBeNull();
    expect(h.host.view?.history.length).toBeLessThanOrEqual(16);
    expect(h.guest.view?.phase).toBe('finished');
  });
});
