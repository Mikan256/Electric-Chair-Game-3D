import { createRng } from '@/game/rng';
import type { MatchSession } from '@/net/session';

export interface BotOptions {
  readonly seed?: string;
  readonly delayMs?: number;
  readonly timers?: boolean;
  /** 試合終了後に自動で再戦を申し込む（ソロ用）。 */
  readonly autoRematch?: boolean;
}

/**
 * ソロモード用の CPU。
 * - set: 攻撃側として電気椅子を一様ランダムに仕掛ける
 * - sit: 守備側として一様ランダムに座る
 * - press: 攻撃側としてボタンを押す
 */
export function attachBot(session: MatchSession, options: BotOptions = {}): () => void {
  const rng = createRng(options.seed ?? `bot:${Date.now()}:${Math.random()}`);
  const delayMs = options.delayMs ?? 450;
  const timers = options.timers !== false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rematchTimer: ReturnType<typeof setTimeout> | null = null;
  let actionKey: string | null = null;
  let rematchRequested = false;

  const choose = (chairs: readonly number[]): number => chairs[Math.floor(rng() * chairs.length)]!;

  const act = (): void => {
    timer = null;
    const view = session.view;
    if (!view) return;
    const key = `${view.matchId}:${view.turn}:${view.phase}`;
    if (actionKey === key) return;

    if (view.phase === 'set' && view.attacker === session.selfIndex && !view.wiredCommitted) {
      actionKey = key;
      session.chooseChair(choose(view.availableChairs));
      return;
    }

    if (view.phase === 'sit' && view.attacker !== session.selfIndex && view.sittingChair === null) {
      actionKey = key;
      session.chooseChair(choose(view.availableChairs));
      return;
    }

    if (view.phase === 'press' && view.attacker === session.selfIndex) {
      actionKey = key;
      session.pressButton();
    }
  };

  const schedule = (): void => {
    if (timer !== null) return;
    if (!timers) {
      act();
      return;
    }
    timer = setTimeout(act, delayMs);
  };

  const unsubscribeView = session.on('view', (view) => {
    if (view.phase === 'finished' && options.autoRematch && !rematchRequested) {
      rematchRequested = true;
      const request = (): void => {
        rematchTimer = null;
        session.rematch();
      };
      if (timers) rematchTimer = setTimeout(request, 800);
      else request();
      return;
    }

    if (view.phase === 'set' || view.phase === 'sit' || view.phase === 'press') {
      if (view.phase !== 'sit' || view.attacker !== session.selfIndex) {
        // schedule; act() re-checks the current view
        schedule();
      }
    }
  });

  if (session.view) schedule();

  return () => {
    unsubscribeView();
    if (timer !== null) clearTimeout(timer);
    if (rematchTimer !== null) clearTimeout(rematchTimer);
    timer = null;
    rematchTimer = null;
  };
}
