import { assetUrl, ASSETS } from '@/assets/registry';
import type { MatchView } from '@/game/types';

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
}

export interface LobbyState {
  roomId: string | null;
  players: LobbyPlayer[];
  youId: string | null;
  isHost: boolean;
  canStart: boolean;
  status: 'connecting' | 'waiting' | 'lobby' | 'starting' | 'offline';
  error?: string;
}

export interface UICallbacks {
  onSolo: () => void;
  onOnline: () => void;
  onRules: () => void;
  onBackToTitle: () => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  onPreviewChair: (chair: number | null) => void;
  onConfirmChair: (chair: number) => void;
  onAdvance: () => void;
  onRematch: () => void;
  onForfeit: () => void;
  onChat: (message: string) => void;
  onToggleSound: () => boolean;
  onFullscreen: () => void;
  onSubmitScore: (score: number, label: string) => void;
}

export interface ChatEntry {
  name: string;
  text: string;
  self?: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  commit: '椅子を選択',
  reveal: '公開待ち',
  result: '判定',
  finished: '試合終了',
};

const REASON_LABEL: Record<string, string> = {
  points: '40ポイント先取',
  shocks: '3回感電させた',
  'turn-limit': 'ターン終了時のポイント勝負',
  draw: '引き分け',
  forfeit: '相手の退出・応答なし',
  abandoned: '両者の応答なし',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * DOM overlay for title / lobby / HUD / result. Kept deliberately independent
 * from three.js and networking so it can be unit-tested or reused.
 */
export class GameUI {
  private readonly callbacks: UICallbacks;
  private readonly screenHost: HTMLElement;
  private readonly flashLayer: HTMLElement;
  private readonly toastStack: HTMLElement;
  private readonly cutinLayer: HTMLElement;
  private readonly logoUrl = assetUrl(ASSETS.logo);
  private hud: HTMLElement | null = null;
  private chairButtons = new Map<number, HTMLButtonElement>();
  private playerCards: HTMLElement[] = [];
  private resultOverlay: HTMLElement | null = null;
  private winnerOverlay: HTMLElement | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private countdownDeadline = 0;
  private currentView: MatchView | null = null;
  private pendingChair: number | null = null;
  private lastTurn = -1;
  private chatOpen = false;
  private chatLog: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private phaseEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private turnEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private confirmButton: HTMLButtonElement | null = null;
  private readyState = false;
  private localCommitted = false;
  private resultRenderedTurn = -1;
  private winnerRenderedKey = '';
  private scoreSubmitted = false;

  constructor(root: HTMLElement, callbacks: UICallbacks) {
    this.callbacks = callbacks;
    root.innerHTML = `
      <div class="flash-layer" id="ui-flash"></div>
      <div class="cutin-layer" id="ui-cutin"></div>
      <div class="toast-stack" id="ui-toasts"></div>
      <div id="ui-screen"></div>
    `;
    this.screenHost = root.querySelector<HTMLElement>('#ui-screen')!;
    this.flashLayer = root.querySelector<HTMLElement>('#ui-flash')!;
    this.toastStack = root.querySelector<HTMLElement>('#ui-toasts')!;
    this.cutinLayer = root.querySelector<HTMLElement>('#ui-cutin')!;
  }

  // --------------------------------------------------------------- screens

  showLoading(progress = 0, label = '読み込み中'): void {
    this.stopCountdown();
    this.setScreen(`
      <div class="screen loading-screen">
        <img class="loading-logo" src="${this.logoUrl}" alt="電気イスゲーム 3D" />
        <div class="progress"><div id="loading-bar" style="width:${Math.round(progress * 100)}%"></div></div>
        <div class="loading-label" id="loading-label">${escapeHtml(label)}</div>
      </div>
    `);
  }

  updateLoading(progress: number, label: string): void {
    const bar = this.screenHost.querySelector<HTMLElement>('#loading-bar');
    const text = this.screenHost.querySelector<HTMLElement>('#loading-label');
    if (bar) bar.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    if (text) text.textContent = label;
  }

  showTitle(
    options: { canOnline: boolean; muted: boolean; embedded: boolean } = {
      canOnline: false,
      muted: false,
      embedded: false,
    },
  ): void {
    this.stopCountdown();
    this.hud = null;
    this.setScreen(`
      <div class="screen title-screen">
        <img class="logo" src="${this.logoUrl}" alt="電気イスゲーム 3D" />
        <div class="title-copy">READ YOUR OPPONENT / 12 CHAIRS / ONE CHAIR IS LIVE</div>
        <div class="menu">
          <button class="btn primary" id="btn-solo">CPUと対戦</button>
          <button class="btn" id="btn-online" ${options.canOnline ? '' : 'disabled'}>
            オンライン対戦${options.canOnline ? '' : '（Flaxiaで起動してください）'}
          </button>
          <button class="btn ghost" id="btn-rules">遊び方 / ルール</button>
        </div>
        <div class="row" style="margin-top:22px">
          <button class="btn ghost small" id="btn-sound">${options.muted ? 'SOUND: OFF' : 'SOUND: ON'}</button>
          ${
            options.embedded
              ? '<button class="btn ghost small" id="btn-fullscreen">FULLSCREEN</button>'
              : ''
          }
        </div>
        <div class="title-copy" style="margin-top:34px;letter-spacing:0.12em">
          UNOFFICIAL FAN GAME ・ DANBALL MIKAN BOX
        </div>
      </div>
    `);
    this.screenHost
      .querySelector('#btn-solo')
      ?.addEventListener('click', () => this.callbacks.onSolo());
    this.screenHost
      .querySelector('#btn-online')
      ?.addEventListener('click', () => this.callbacks.onOnline());
    this.screenHost
      .querySelector('#btn-rules')
      ?.addEventListener('click', () => this.callbacks.onRules());
    this.screenHost.querySelector('#btn-sound')?.addEventListener('click', () => {
      const muted = this.callbacks.onToggleSound();
      const button = this.screenHost.querySelector<HTMLButtonElement>('#btn-sound');
      if (button) button.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
    });
    this.screenHost
      .querySelector('#btn-fullscreen')
      ?.addEventListener('click', () => this.callbacks.onFullscreen());
  }

  showRules(): void {
    this.setScreen(`
      <div class="screen">
        <div class="panel" style="max-width:680px">
          <h2>電気イスゲーム 3D</h2>
          <p>12脚の椅子のうち1脚に電流が仕掛けられている。相手の思考を読み、安全な椅子に座れ。</p>
          <div class="rule-grid">
            <div><span>回避成功</span><strong>座った椅子の番号 = 得点</strong></div>
            <div><span>感電</span><strong>自分の累積ポイントが0に</strong></div>
            <div><span>得点した椅子</span><strong>以後使用不可</strong></div>
            <div><span>感電した椅子</span><strong>以後も使用可能</strong></div>
            <div><span>勝利条件</span><strong>40pt先取 / 3回感電させる / 8ターン終了時のポイント</strong></div>
          </div>
          <p class="muted">
            両者は同時に秘密の選択をコミットし、両方の公開が揃ってから判定します。
            ホストでも相手の選択を先に見ることはできません。
          </p>
          <div class="row" style="margin-top:20px">
            <button class="btn" id="btn-back">タイトルへ戻る</button>
          </div>
        </div>
      </div>
    `);
    this.screenHost
      .querySelector('#btn-back')
      ?.addEventListener('click', () => this.callbacks.onBackToTitle());
  }

  showLobby(state: LobbyState): void {
    this.stopCountdown();
    this.hud = null;
    this.readyState = state.players.find((p) => p.id === state.youId)?.isReady ?? false;
    const statusText =
      state.status === 'connecting'
        ? 'ルームに接続しています…'
        : state.status === 'waiting'
          ? '対戦相手を待っています…'
          : state.status === 'offline'
            ? 'オンライン対戦は Flaxia 上で起動してください'
            : '対戦相手が揃ったら準備OKを押してください';

    const players = state.players
      .map(
        (player) => `
          <div class="lobby-player ${player.id === state.youId ? 'you' : ''}">
            <span class="dot ${player.isReady ? 'ready' : ''}"></span>
            <span class="name">${escapeHtml(player.name)}${player.id === state.youId ? '（あなた）' : ''}</span>
            ${player.isHost ? '<span class="dot host"></span><span class="badge">HOST</span>' : ''}
            <span class="badge">${player.isReady ? 'READY' : 'WAITING'}</span>
          </div>
        `,
      )
      .join('');

    const enough = state.players.length >= 2;
    this.setScreen(`
      <div class="screen">
        <div class="panel">
          <h2>ONLINE MATCH</h2>
          <div class="kv"><span>ROOM</span><strong class="room-code">${escapeHtml(state.roomId ?? '---')}</strong></div>
          <div class="kv"><span>STATUS</span><strong>${state.players.length} / 2</strong></div>
          <div class="players">${players || '<div class="lobby-player"><span class="name">接続中…</span></div>'}</div>
          <p class="muted">${escapeHtml(state.error ?? statusText)}</p>
          <div class="row" style="margin-top:18px">
            <button class="btn ${this.readyState ? 'ghost' : 'primary'}" id="btn-ready" ${enough ? '' : 'disabled'}>
              ${this.readyState ? '準備を取消' : '準備OK'}
            </button>
            ${
              state.isHost
                ? `<button class="btn primary" id="btn-start" ${state.canStart ? '' : 'disabled'}>試合開始</button>`
                : ''
            }
            <button class="btn ghost" id="btn-leave">退出</button>
          </div>
          ${
            state.roomId
              ? `<button class="btn ghost small" id="btn-copy" style="margin-top:12px">ルームIDをコピー</button>`
              : ''
          }
        </div>
      </div>
    `);
    this.screenHost.querySelector('#btn-ready')?.addEventListener('click', () => {
      this.readyState = !this.readyState;
      this.callbacks.onReady(this.readyState);
    });
    this.screenHost
      .querySelector('#btn-start')
      ?.addEventListener('click', () => this.callbacks.onStart());
    this.screenHost
      .querySelector('#btn-leave')
      ?.addEventListener('click', () => this.callbacks.onLeave());
    this.screenHost.querySelector('#btn-copy')?.addEventListener('click', () => {
      if (!state.roomId) return;
      void navigator.clipboard?.writeText(state.roomId).then(
        () => this.showToast('ルームIDをコピーしました', 'info'),
        () => this.showToast('コピーに失敗しました'),
      );
    });
  }

  // ------------------------------------------------------------------ game

  showGame(view: MatchView, options: { online: boolean; roomId: string | null }): void {
    this.stopCountdown();
    this.currentView = view;
    this.pendingChair = null;
    this.lastTurn = -1;
    this.localCommitted = false;
    this.resultRenderedTurn = -1;
    this.winnerRenderedKey = '';
    this.scoreSubmitted = false;
    this.chatOpen = false;
    this.chatLog = null;
    this.setScreen(`
      <div class="hud">
        <div class="hud-top">
          <span class="turn" id="hud-turn">TURN 1 / 8</span>
          <span class="phase" id="hud-phase">椅子を選択</span>
          <span class="timer" id="hud-timer">--</span>
        </div>
        <div class="player-card left" id="hud-player-0">
          <div class="role">ATTACKER</div>
          <div class="name">---</div>
          <div class="points">0<small>pt</small></div>
          <div class="shocks"></div>
        </div>
        <div class="player-card right" id="hud-player-1">
          <div class="role">DEFENDER</div>
          <div class="name">---</div>
          <div class="points">0<small>pt</small></div>
          <div class="shocks"></div>
        </div>
        <div class="hint" id="hud-hint">椅子を選んでください</div>
        <div class="bottom-panel">
          <div class="chair-grid" id="chair-grid"></div>
          <div class="actions">
            <span class="status" id="hud-status">椅子を選択</span>
            <button class="btn primary" id="btn-confirm" disabled>この椅子で決定</button>
            <button class="btn ghost small" id="btn-forfeit">降参</button>
            ${options.online ? '<button class="btn ghost small" id="btn-chat">CHAT</button>' : ''}
          </div>
        </div>
        ${
          options.online
            ? `<div class="chat-panel hidden" id="chat-panel">
                 <div class="chat-log" id="chat-log"></div>
                 <form class="chat-form" id="chat-form">
                   <input id="chat-input" maxlength="200" placeholder="メッセージ…" autocomplete="off" />
                   <button type="submit">送信</button>
                 </form>
               </div>`
            : ''
        }
        <div id="result-host"></div>
      </div>
    `);

    this.hud = this.screenHost.querySelector('.hud');
    this.chairButtons.clear();
    for (let chair = 1; chair <= 12; chair += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chair-btn';
      button.textContent = String(chair);
      button.dataset.chair = String(chair);
      button.addEventListener('click', () => {
        if (button.disabled) return;
        this.pendingChair = this.pendingChair === chair ? null : chair;
        this.updateChairButtons();
        this.callbacks.onPreviewChair(this.pendingChair);
      });
      this.screenHost.querySelector('#chair-grid')?.append(button);
      this.chairButtons.set(chair, button);
    }
    this.playerCards = [
      this.screenHost.querySelector('#hud-player-0')!,
      this.screenHost.querySelector('#hud-player-1')!,
    ];
    this.hintEl = this.screenHost.querySelector('#hud-hint');
    this.phaseEl = this.screenHost.querySelector('#hud-phase');
    this.timerEl = this.screenHost.querySelector('#hud-timer');
    this.turnEl = this.screenHost.querySelector('#hud-turn');
    this.statusEl = this.screenHost.querySelector('#hud-status');
    this.confirmButton = this.screenHost.querySelector('#btn-confirm');
    this.resultOverlay = null;
    this.winnerOverlay = null;

    this.confirmButton?.addEventListener('click', () => {
      if (this.pendingChair === null) return;
      this.callbacks.onConfirmChair(this.pendingChair);
    });
    this.screenHost.querySelector('#btn-forfeit')?.addEventListener('click', () => {
      this.callbacks.onForfeit();
    });
    this.screenHost.querySelector('#btn-chat')?.addEventListener('click', () => {
      this.chatOpen = !this.chatOpen;
      this.screenHost.querySelector('#chat-panel')?.classList.toggle('hidden', !this.chatOpen);
    });
    this.screenHost
      .querySelector<HTMLFormElement>('#chat-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = this.screenHost.querySelector<HTMLInputElement>('#chat-input');
        if (!input || !input.value.trim()) return;
        this.callbacks.onChat(input.value.trim());
        input.value = '';
      });
    this.chatLog = this.screenHost.querySelector('#chat-log');

    if (options.online && options.roomId) {
      this.showToast(`ROOM: ${options.roomId}`, 'info');
    }
    this.updateView(view);
    this.startCountdown();
  }

  updateView(view: MatchView): void {
    this.currentView = view;
    if (!this.hud) {
      this.showGame(view, { online: false, roomId: null });
      return;
    }
    const self = view.you;
    const me = view.players[self];

    for (const index of [0, 1] as const) {
      const card = this.playerCards[index];
      if (!card) continue;
      const player = view.players[index];
      const isAttacker = view.attacker === index;
      card.classList.toggle('attacker', isAttacker);
      card.classList.toggle('defender', !isAttacker);
      card.querySelector('.role')!.textContent =
        `${isAttacker ? '攻撃側 / ATTACKER' : '守備側 / DEFENDER'}${index === self ? ' ・ YOU' : ''}`;
      card.querySelector('.name')!.textContent = player.name;
      card.querySelector('.points')!.innerHTML = `${player.points}<small>pt</small>`;
      const shocks = card.querySelector('.shocks')!;
      shocks.innerHTML = Array.from(
        { length: view.config.shocksToWin },
        (_, i) => `<span class="shock-pip ${i < player.shocksDealt ? 'on' : ''}"></span>`,
      ).join('');
    }

    if (this.turnEl) {
      this.turnEl.textContent = `TURN ${view.turn} / ${view.config.maxTurns}`;
    }
    if (this.phaseEl) this.phaseEl.textContent = PHASE_LABEL[view.phase] ?? view.phase;

    if (this.lastTurn !== view.turn) {
      this.lastTurn = view.turn;
      this.pendingChair = null;
      this.localCommitted = false;
      this.resultRenderedTurn = -1;
    }

    const committed = me.committed || this.localCommitted;
    if (
      view.phase === 'commit' &&
      !committed &&
      this.pendingChair !== null &&
      view.retiredChairs.includes(this.pendingChair)
    ) {
      this.pendingChair = null;
    }

    if (this.hintEl) {
      if (view.phase === 'commit') {
        this.hintEl.textContent = committed
          ? '選択済み。相手のコミットを待っています…'
          : view.attacker === self
            ? '電流を仕掛ける椅子を選べ'
            : '座る椅子を選べ。相手の思惑を読め';
      } else if (view.phase === 'reveal') {
        this.hintEl.textContent = '両者の選択を公開中…';
      } else if (view.phase === 'result') {
        const result = view.lastResult;
        if (!result) {
          this.hintEl.textContent = '判定';
        } else if (result.hit) {
          this.hintEl.textContent =
            result.defender === self ? 'あなたが感電！' : '相手を感電させた！';
        } else {
          this.hintEl.textContent = result.defender === self ? '回避成功！' : '相手に回避された';
        }
      } else {
        this.hintEl.textContent = view.outcome?.kind === 'draw' ? '引き分け' : '試合終了';
      }
    }

    if (this.statusEl) {
      if (view.phase === 'commit') {
        this.statusEl.textContent = committed
          ? '相手の選択を待っています…'
          : view.attacker === self
            ? '仕掛ける椅子を選択'
            : '座る椅子を選択';
      } else if (view.phase === 'reveal') {
        this.statusEl.textContent = '公開待ち…';
      } else if (view.phase === 'result') {
        this.statusEl.textContent = '判定';
      } else {
        this.statusEl.textContent = '試合終了';
      }
    }

    this.updateChairButtons();
    if (this.confirmButton) {
      const disabled = view.phase !== 'commit' || committed || this.pendingChair === null;
      this.confirmButton.classList.toggle('hidden', view.phase !== 'commit');
      this.confirmButton.disabled = disabled;
      this.confirmButton.textContent = committed ? '選択済み' : 'この椅子で決定';
    }
    this.screenHost
      .querySelector('#btn-confirm')
      ?.classList.toggle('hidden', view.phase !== 'commit' || committed);
    this.screenHost
      .querySelector('#btn-forfeit')
      ?.classList.toggle('hidden', view.phase === 'finished' || view.phase === 'result');
    this.screenHost
      .querySelector('.bottom-panel')
      ?.classList.toggle('hidden', view.phase === 'result' || view.phase === 'finished');

    if (view.phase === 'result') this.renderResult(view);
    else this.clearResult();
    if (view.phase === 'finished') this.renderWinner(view);
    else this.clearWinner();

    this.countdownDeadline = view.deadline;
    this.updateCountdown();
  }

  setLocalCommitted(committed: boolean): void {
    this.localCommitted = committed;
    if (this.currentView) this.updateView(this.currentView);
  }

  private updateChairButtons(): void {
    const view = this.currentView;
    if (!view) return;
    const me = view.players[view.you];
    const committed = me.committed || this.localCommitted;
    for (const [chair, button] of this.chairButtons) {
      const retired = view.retiredChairs.includes(chair);
      button.classList.toggle('retired', retired);
      button.classList.toggle('selected', this.pendingChair === chair);
      button.disabled =
        retired ||
        view.phase !== 'commit' ||
        committed ||
        (view.phase === 'commit' && !view.availableChairs.includes(chair));
    }
  }

  private renderResult(view: MatchView): void {
    const result = view.lastResult;
    if (!result) return;
    if (this.resultRenderedTurn === result.turn && this.resultOverlay) return;
    this.resultRenderedTurn = result.turn;
    if (!this.resultOverlay) {
      const host = this.screenHost.querySelector('#result-host');
      if (!host) return;
      host.innerHTML = '<div class="result-overlay" id="result-overlay"></div>';
      this.resultOverlay = host.querySelector('#result-overlay');
    }
    const defenderName = view.players[result.defender].name;
    const isDefender = result.defender === view.you;
    const title = result.hit ? '感電' : isDefender ? `+${result.pointsAwarded}` : '回避された';
    const className = result.hit ? 'shock' : isDefender ? 'avoid' : 'points';
    const sub = result.hit
      ? isDefender
        ? 'あなたは電流を受けた'
        : `${defenderName} に感電させた`
      : isDefender
        ? `あなたは ${result.sittingChair}番で回避`
        : `${defenderName} は ${result.sittingChair}番で回避`;
    const detail = result.hit
      ? isDefender
        ? 'あなたのポイントは 0pt に'
        : `${defenderName} のポイントを 0 にした`
      : `仕掛けられた椅子: ${result.wiredChair}番 / 座った椅子: ${result.sittingChair}番`;
    const overlay = this.resultOverlay;
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="result-title ${className}">${title}</div>
      <div class="result-sub">${escapeHtml(sub)}</div>
      <div class="result-detail">${escapeHtml(detail)}</div>
      <button class="btn primary" id="btn-result-next" style="margin-top:16px">次へ</button>
    `;
    overlay
      .querySelector('#btn-result-next')
      ?.addEventListener('click', () => this.callbacks.onAdvance());
    overlay.style.pointerEvents = 'none';
    const button = overlay.querySelector<HTMLButtonElement>('#btn-result-next');
    if (button) button.style.pointerEvents = 'auto';
  }

  private clearResult(): void {
    if (!this.resultOverlay) return;
    this.resultOverlay.remove();
    this.resultOverlay = null;
  }

  private renderWinner(view: MatchView): void {
    if (!view.outcome) return;
    const key = `${view.matchId}:${view.outcome.kind}:${view.outcome.reason}:${view.outcome.winner}`;
    if (this.winnerRenderedKey === key && this.winnerOverlay) return;
    this.winnerRenderedKey = key;
    this.scoreSubmitted = false;
    if (!this.winnerOverlay) {
      const host = this.screenHost.querySelector('#result-host');
      if (!host) return;
      const overlay = document.createElement('div');
      overlay.className = 'winner-overlay';
      host.append(overlay);
      this.winnerOverlay = overlay;
    }
    const outcome = view.outcome;
    const winnerIndex = outcome.winner;
    const winnerName = winnerIndex === null ? null : view.players[winnerIndex].name;
    const iWon = winnerIndex === view.you;
    const title = outcome.kind === 'draw' ? 'DRAW' : iWon ? 'WINNER' : 'DEFEAT';
    const reason = REASON_LABEL[outcome.reason] ?? outcome.reason;
    const scores = view.players
      .map(
        (player) => `
          <div class="score-box">
            <div class="label">${escapeHtml(player.name)}</div>
            <div class="value">${player.points}<small>pt</small></div>
            <div class="label">感電 ${player.shocksDealt} / ${view.config.shocksToWin}</div>
          </div>`,
      )
      .join('');
    this.winnerOverlay.innerHTML = `
      <div class="winner-title">${title}</div>
      <div class="winner-name">${escapeHtml(winnerName ?? (outcome.kind === 'draw' ? '引き分け' : '---'))}</div>
      <div class="winner-reason">${escapeHtml(reason)}</div>
      <div class="score-row">${scores}</div>
      <div class="row">
        <button class="btn primary" id="btn-rematch">再戦</button>
        <button class="btn ghost" id="btn-back-title">タイトルへ</button>
      </div>
    `;
    this.winnerOverlay
      .querySelector('#btn-rematch')
      ?.addEventListener('click', () => this.callbacks.onRematch());
    this.winnerOverlay
      .querySelector('#btn-back-title')
      ?.addEventListener('click', () => this.callbacks.onBackToTitle());
    if (outcome.kind === 'win' && winnerIndex === view.you && !this.scoreSubmitted) {
      this.scoreSubmitted = true;
      this.callbacks.onSubmitScore(
        view.players[view.you].points,
        `${reason} / ${winnerName ?? ''}`,
      );
    }
  }

  private clearWinner(): void {
    if (!this.winnerOverlay) return;
    this.winnerOverlay.remove();
    this.winnerOverlay = null;
  }

  // -------------------------------------------------------------- utilities

  showToast(message: string, kind: 'info' | 'error' = 'error'): void {
    const toast = document.createElement('div');
    toast.className = `toast ${kind === 'info' ? 'info' : ''}`;
    toast.textContent = message;
    this.toastStack.append(toast);
    setTimeout(() => toast.remove(), 3800);
  }

  /** Full-screen video cut-in using the legacy Unity video assets. */
  playCutIn(kind: 'final-thunder' | 'lightning'): void {
    const source =
      kind === 'final-thunder'
        ? assetUrl(ASSETS.videoFinalThunder)
        : assetUrl(ASSETS.videoLightning);
    const video = document.createElement('video');
    video.className = `cutin-video ${kind}`;
    video.src = source;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = kind === 'lightning';
    video.volume = kind === 'final-thunder' ? 0.8 : 0.2;
    video.addEventListener('ended', () => video.remove());
    this.cutinLayer.append(video);
    window.setTimeout(() => video.remove(), kind === 'final-thunder' ? 12_000 : 4_000);
    void video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => undefined);
    });
  }

  flash(kind: 'shock' | 'avoid' | 'win'): void {
    this.flashLayer.className = `flash-layer active ${kind}`;
    setTimeout(() => {
      this.flashLayer.className = `flash-layer ${kind}`;
    }, 90);
  }

  addChat(entry: ChatEntry): void {
    if (!this.chatLog) return;
    const row = document.createElement('div');
    row.innerHTML = `<span class="who">${escapeHtml(entry.name)}</span>: ${escapeHtml(entry.text)}`;
    this.chatLog.append(row);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    if (!this.chatOpen) {
      this.screenHost.querySelector('#chat-panel')?.classList.remove('hidden');
      this.chatOpen = true;
    }
  }

  setPendingChair(chair: number | null): void {
    this.pendingChair = chair;
    this.updateChairButtons();
    if (this.confirmButton) this.confirmButton.disabled = chair === null;
  }

  get pending(): number | null {
    return this.pendingChair;
  }

  private setScreen(html: string): void {
    this.screenHost.innerHTML = html;
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.countdownTimer = setInterval(() => this.updateCountdown(), 250);
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private updateCountdown(): void {
    if (!this.timerEl || !this.currentView) return;
    const deadline = this.currentView.deadline;
    if (deadline <= 0) {
      this.timerEl.textContent = '--';
      this.timerEl.classList.remove('urgent');
      return;
    }
    const remaining = Math.max(0, deadline - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    this.timerEl.textContent = `${seconds}s`;
    this.timerEl.classList.toggle('urgent', seconds <= 5);
    void this.countdownDeadline;
  }

  dispose(): void {
    this.stopCountdown();
  }
}
