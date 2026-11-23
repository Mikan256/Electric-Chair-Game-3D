import { createRng } from '@/game/rng';
import type { MatchSession } from '@/net/session';

export interface BotOptions {
  /** 省略時は Math.random 相当のシード。 */
  readonly seed?: string;
  /** 思考時間（ミリ秒）。テストでは 0 を渡す。 */
  readonly delayMs?: number;
  readonly timers?: boolean;
  /** 試合終了後に自動で再戦を申し込む（ソロ用）。 */
  readonly autoRematch?: boolean;
}

/**
 * ソロモード用の CPU。椅子の選択は一様ランダム。
 * 攻撃側・守備側のどちらでも「相手に読まれにくい」ことが最善なので、
 * 学習や履歴依存はあえて持たせない（対人戦と同じ土俵）。
 */
export function attachBot(session: MatchSession, options: BotOptions = {}): () => void {
  const rng = createRng(options.seed ?? `bot:${Date.now()}:${Math.random()}`);
  const delayMs = options.delayMs ?? 500;
  const timers = options.timers !== false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rematchTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTurn: number | null = null;
  let rematchRequested = false;

  const act = (): void => {
    timer = null;
    const view = session.view;
    if (!view || view.phase !== 'commit') return;
    if (session.hasCommittedThisTurn) return;
    if (lastTurn === view.turn) return;
    if (view.availableChairs.length === 0) return;

    const chairs = view.availableChairs;
    const chair = chairs[Math.floor(rng() * chairs.length)]!;
    lastTurn = view.turn;
    session.chooseChair(chair);
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
    if (view.phase === 'commit' && view.turn !== lastTurn) {
      rematchRequested = false;
      schedule();
    }
  });

  // セッション生成時点で既に commit フェーズのことがある。
  if (session.view?.phase === 'commit') schedule();

  return () => {
    unsubscribeView();
    if (timer !== null) clearTimeout(timer);
    if (rematchTimer !== null) clearTimeout(rematchTimer);
    timer = null;
    rematchTimer = null;
  };
}
