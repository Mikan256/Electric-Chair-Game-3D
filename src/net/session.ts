import { commitmentHash, createSalt } from '@/game/rng';
import { applyAction, createMatch, createView } from '@/game/rules';
import type {
  MatchAction,
  MatchConfig,
  MatchState,
  MatchView,
  PlayerIdentity,
  PlayerIndex,
} from '@/game/types';
import { Emitter } from './emitter';
import {
  isWireMessage,
  NET_PROTOCOL_VERSION,
  type ClientAction,
  type WireMessage,
} from './protocol';
import type { Transport } from './transport';

export interface MatchSessionOptions {
  readonly transport: Transport;
  readonly selfId: string;
  /** [host, guest] の順。 */
  readonly players: readonly [PlayerIdentity, PlayerIdentity];
  readonly isHost: boolean;
  readonly config?: Partial<MatchConfig>;
  readonly startingAttacker?: PlayerIndex;
  readonly now?: () => number;
  /** テストでは false にして tick() を手動で呼ぶ。 */
  readonly timers?: boolean;
  readonly heartbeatMs?: number;
}

export interface SessionError {
  readonly code: string;
  readonly message: string;
}

export interface MatchSessionEvents {
  view: MatchView;
  error: SessionError;
  rematch: void;
  closed: void;
}

const DEFAULT_HEARTBEAT_MS = 2_000;

function isMatchView(value: unknown): value is MatchView {
  if (!value || typeof value !== 'object') return false;
  const view = value as Partial<MatchView>;
  return (
    typeof view.matchId === 'string' &&
    (view.phase === 'set' ||
      view.phase === 'sit' ||
      view.phase === 'press' ||
      view.phase === 'result' ||
      view.phase === 'finished') &&
    typeof view.turn === 'number' &&
    Array.isArray(view.players) &&
    view.players.length === 2 &&
    Array.isArray(view.availableChairs) &&
    (view.sittingChair === null || typeof view.sittingChair === 'number') &&
    typeof view.wiredCommitted === 'boolean' &&
    (view.you === 0 || view.you === 1)
  );
}

export class MatchSession {
  readonly selfId: string;
  readonly isHost: boolean;
  readonly selfIndex: PlayerIndex;
  readonly players: readonly [PlayerIdentity, PlayerIdentity];

  private readonly transport: Transport;
  private readonly config: Partial<MatchConfig> | undefined;
  private readonly startingAttacker: PlayerIndex | undefined;
  private readonly now: () => number;
  private readonly useTimers: boolean;
  private readonly heartbeatMs: number;
  private readonly emitter = new Emitter<MatchSessionEvents>();
  private readonly unsubscribe: () => void;

  private state: MatchState | null = null;
  private currentView: MatchView | null = null;
  /** 攻撃側がセットした秘密。press までローカル保持。 */
  private pendingSecret: { chair: number; salt: string } | null = null;
  private lastSeq = 0;
  private lastMatchId: string | null = null;
  private hostSeq = 0;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private rematchReady: [boolean, boolean] = [false, false];
  private disposed = false;

  constructor(options: MatchSessionOptions) {
    this.transport = options.transport;
    this.selfId = options.selfId;
    this.isHost = options.isHost;
    this.players = options.players;
    this.config = options.config;
    this.startingAttacker = options.startingAttacker;
    this.now = options.now ?? Date.now;
    this.useTimers = options.timers !== false;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.selfIndex = options.players[0].id === options.selfId ? 0 : 1;

    this.unsubscribe = this.transport.subscribe((message, from) => this.receive(message, from));

    if (this.isHost) {
      this.state = createMatch({
        players: this.players,
        config: this.config,
        startingAttacker: this.startingAttacker,
        now: this.now(),
      });
      this.publish();
      this.startHeartbeat();
    } else {
      this.send({
        t: 'hello',
        from: this.selfId,
        name: this.players[this.selfIndex].name,
        v: NET_PROTOCOL_VERSION,
      });
    }
  }

  // ---------------------------------------------------------------- getters

  get view(): MatchView | null {
    return this.currentView;
  }

  get mySecret(): { chair: number; salt: string } | null {
    return this.pendingSecret;
  }

  get isAttacker(): boolean {
    return this.currentView?.attacker === this.selfIndex;
  }

  get isDefender(): boolean {
    return this.currentView !== null && this.currentView.attacker !== this.selfIndex;
  }

  /** このターン、自分の選択が確定しているか（UI/ボット用）。 */
  get hasActedThisTurn(): boolean {
    const view = this.currentView;
    if (!view) return false;
    if (view.phase === 'set') return view.attacker === this.selfIndex && view.wiredCommitted;
    if (view.phase === 'sit') return view.sittingChair !== null;
    return false;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  // ---------------------------------------------------------------- events

  on<K extends keyof MatchSessionEvents>(
    event: K,
    handler: (payload: MatchSessionEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, handler);
  }

  // --------------------------------------------------------------- commands

  /**
   * 椅子を確定する。
   * - set フェーズ: 攻撃側が電気椅子を仕掛ける（秘密はローカル保持）
   * - sit フェーズ: 守備側が座る椅子を選ぶ（公開）
   * - press は pressButton() を使う
   */
  chooseChair(chair: number): { ok: true } | { ok: false; code: string; message: string } {
    if (this.disposed) return { ok: false, code: 'CLOSED', message: 'セッションが終了しています' };
    if (!this.currentView) {
      return { ok: false, code: 'NOT_READY', message: 'まだ試合が始まっていません' };
    }
    this.hostMaybeTimeout();
    const view = this.currentView;
    if (!view) return { ok: false, code: 'NOT_READY', message: '試合が始まっていません' };

    if (view.phase === 'set') {
      if (view.attacker !== this.selfIndex) {
        return { ok: false, code: 'NOT_YOUR_TURN', message: '攻撃側が電気椅子を仕掛けています' };
      }
      if (view.wiredCommitted) {
        return { ok: false, code: 'ALREADY_SET', message: 'すでに仕掛けています' };
      }
      if (!view.availableChairs.includes(chair)) {
        return { ok: false, code: 'INVALID_CHAIR', message: 'その椅子は選べません' };
      }

      const salt = createSalt();
      const hash = commitmentHash(chair, salt);
      this.pendingSecret = { chair, salt };
      if (this.isHost) {
        this.hostApply({ type: 'set', player: this.selfIndex, hash });
      } else {
        this.sendAction({ type: 'set', hash });
        this.emitter.emit('view', view);
      }
      return { ok: true };
    }

    if (view.phase === 'sit') {
      if (view.attacker === this.selfIndex) {
        return { ok: false, code: 'NOT_YOUR_TURN', message: '守備側が椅子を選んでいます' };
      }
      if (view.sittingChair !== null) {
        return { ok: false, code: 'ALREADY_SEATED', message: 'すでに座る椅子を選んでいます' };
      }
      if (!view.availableChairs.includes(chair)) {
        return { ok: false, code: 'INVALID_CHAIR', message: 'その椅子には座れません' };
      }
      if (this.isHost) {
        this.hostApply({ type: 'sit', player: this.selfIndex, chair });
      } else {
        this.sendAction({ type: 'sit', chair });
      }
      return { ok: true };
    }

    return {
      ok: false,
      code: 'INVALID_PHASE',
      message: view.phase === 'press' ? 'ボタンを押してください' : '今は椅子を選べません',
    };
  }

  /** 攻撃側が前方の台座のボタンを押す。 */
  pressButton(): { ok: true } | { ok: false; code: string; message: string } {
    if (this.disposed) return { ok: false, code: 'CLOSED', message: 'セッションが終了しています' };
    this.hostMaybeTimeout();
    const view = this.currentView;
    if (!view) return { ok: false, code: 'NOT_READY', message: '試合が始まっていません' };
    if (view.phase !== 'press') {
      return { ok: false, code: 'INVALID_PHASE', message: 'まだボタンを押せません' };
    }
    if (view.attacker !== this.selfIndex) {
      return { ok: false, code: 'NOT_YOUR_TURN', message: 'ボタンを押せるのは攻撃側だけです' };
    }
    if (!this.pendingSecret) {
      return { ok: false, code: 'NOT_READY', message: '電気椅子の情報がありません' };
    }

    const { chair, salt } = this.pendingSecret;
    if (this.isHost) {
      this.hostApply({ type: 'press', player: this.selfIndex, chair, salt });
    } else {
      this.sendAction({ type: 'press', chair, salt });
    }
    return { ok: true };
  }

  advance(): void {
    if (this.currentView?.phase !== 'result') return;
    if (this.isHost) this.hostApply({ type: 'advance' });
    else this.sendAction({ type: 'advance' });
  }

  forfeit(): void {
    if (!this.currentView || this.currentView.phase === 'finished') return;
    if (this.isHost) this.hostApply({ type: 'forfeit', player: this.selfIndex });
    else this.sendAction({ type: 'forfeit' });
  }

  rematch(): void {
    if (this.currentView?.phase !== 'finished') return;
    if (this.isHost) {
      this.rematchReady[0] = true;
      this.maybeStartRematch();
    } else {
      this.send({ t: 'rematch', from: this.selfId, ready: true });
    }
  }

  requestSync(): void {
    if (this.isHost) this.publish();
    else this.send({ t: 'sync', from: this.selfId });
  }

  tick(): void {
    if (!this.isHost || !this.state || !this.currentView) return;
    const deadline = this.currentView.deadline;
    if (deadline > 0 && this.now() >= deadline) {
      this.hostApply({ type: 'timeout' });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.unsubscribe();
    this.emitter.emit('closed', undefined);
    this.emitter.clear();
  }

  // --------------------------------------------------------------- internals

  private send(message: WireMessage): void {
    if (this.disposed) return;
    this.transport.send(message);
  }

  private sendAction(action: ClientAction): void {
    if (!this.currentView) return;
    this.send({
      t: 'action',
      from: this.selfId,
      action,
      turn: this.currentView.turn,
      phase: this.currentView.phase,
    });
  }

  private receive(raw: unknown, from: string): void {
    if (this.disposed) return;
    if (!isWireMessage(raw)) return;
    if (raw.from === this.selfId || from !== raw.from) return;

    switch (raw.t) {
      case 'hello': {
        if (this.isHost && raw.from === this.players[1].id) this.publish();
        break;
      }
      case 'view': {
        if (this.isHost) return;
        if (raw.to && raw.to !== this.selfId) return;
        if (!isMatchView(raw.view)) return;
        if (typeof raw.seq !== 'number' || raw.seq <= this.lastSeq) {
          if (typeof raw.seq === 'number' && raw.seq < this.lastSeq) {
            this.send({ t: 'sync', from: this.selfId });
          }
          return;
        }
        if (raw.seq > this.lastSeq + 1) {
          this.send({ t: 'sync', from: this.selfId });
        }
        this.lastSeq = raw.seq;
        this.applyView(raw.view);
        break;
      }
      case 'action': {
        if (!this.isHost) return;
        if (raw.from !== this.players[1].id) return;
        if (!this.currentView) return;
        if (raw.turn !== this.currentView.turn || raw.phase !== this.currentView.phase) {
          this.send({
            t: 'error',
            from: this.selfId,
            code: 'STALE',
            message: '古いアクションを無視しました',
          });
          return;
        }
        this.hostMaybeTimeout();
        if (!this.currentView || this.currentView.phase !== raw.phase) return;
        this.hostApply(this.fromClientAction(raw.action, 1));
        break;
      }
      case 'sync': {
        if (this.isHost && raw.from === this.players[1].id) this.publish();
        break;
      }
      case 'rematch': {
        if (!this.isHost) return;
        if (raw.from !== this.players[1].id) return;
        this.rematchReady[1] = raw.ready;
        this.maybeStartRematch();
        break;
      }
      case 'error': {
        this.emitter.emit('error', { code: raw.code, message: raw.message });
        break;
      }
      case 'chat':
        break;
      default:
        break;
    }
  }

  private fromClientAction(action: ClientAction, player: PlayerIndex): MatchAction {
    switch (action.type) {
      case 'set':
        return { type: 'set', player, hash: action.hash };
      case 'sit':
        return { type: 'sit', player, chair: action.chair };
      case 'press':
        return { type: 'press', player, chair: action.chair, salt: action.salt };
      case 'advance':
        return { type: 'advance' };
      case 'forfeit':
        return { type: 'forfeit', player };
      default:
        return { type: 'timeout' };
    }
  }

  private hostMaybeTimeout(): void {
    if (!this.isHost) return;
    if (
      this.currentView &&
      this.currentView.deadline > 0 &&
      this.now() >= this.currentView.deadline
    ) {
      this.hostApply({ type: 'timeout' });
    }
  }

  private hostApply(action: MatchAction): void {
    if (!this.state) return;
    const result = applyAction(this.state, action, this.now());
    if (!result.ok) {
      this.emitter.emit('error', { code: result.code, message: result.message });
      this.send({
        t: 'error',
        from: this.selfId,
        code: result.code,
        message: result.message,
      });
      return;
    }
    this.state = result.state;
    if (this.state.phase === 'result' || this.state.phase === 'finished') {
      this.pendingSecret = null;
    }
    this.publish();
  }

  private publish(): void {
    if (!this.state) return;
    this.hostSeq += 1;
    const seq = this.hostSeq;
    this.applyView(createView(this.state, this.selfIndex));
    this.send({
      t: 'view',
      from: this.selfId,
      to: this.players[1].id,
      seq,
      view: createView(this.state, 1),
    });
    this.armDeadline();
  }

  private applyView(view: MatchView): void {
    if (this.lastMatchId !== view.matchId) {
      this.lastMatchId = view.matchId;
      this.pendingSecret = null;
    }
    this.currentView = view;
    if (view.phase === 'result' || view.phase === 'finished') {
      this.pendingSecret = null;
    }
    this.emitter.emit('view', view);
  }

  private armDeadline(): void {
    if (this.deadlineTimer !== null) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
    if (!this.useTimers || !this.isHost || !this.currentView) return;
    const remaining = this.currentView.deadline - this.now();
    if (this.currentView.deadline <= 0) return;
    const delay = Math.max(0, Math.min(remaining + 50, 2_147_000_000));
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      this.tick();
    }, delay);
  }

  private startHeartbeat(): void {
    if (!this.useTimers || this.heartbeatMs <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.isHost && this.state) this.publish();
    }, this.heartbeatMs);
  }

  private maybeStartRematch(): void {
    if (!this.isHost) return;
    if (!this.rematchReady[0] || !this.rematchReady[1]) return;
    this.rematchReady = [false, false];
    this.state = createMatch({
      players: this.players,
      config: this.config,
      startingAttacker: this.startingAttacker,
      now: this.now(),
    });
    this.pendingSecret = null;
    this.applyView(createView(this.state, this.selfIndex));
    this.emitter.emit('rematch', undefined);
    this.publish();
  }

  private clearTimers(): void {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.deadlineTimer = null;
    this.heartbeatTimer = null;
  }
}
