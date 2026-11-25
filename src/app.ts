import { attachBot } from '@/game/bot';
import type { MatchView, PlayerIdentity } from '@/game/types';
import { FlaxiaClient } from '@/net/flaxia-client';
import { FlaxiaTransport } from '@/net/flaxia-transport';
import { MemoryBus } from '@/net/memory';
import { MatchSession } from '@/net/session';
import type { Transport } from '@/net/transport';
import { GAME_ID } from '@/assets/registry';
import { Theater } from '@/scene/stage';
import { GameUI, type LobbyState } from '@/ui/game-ui';

type Mode = 'title' | 'solo' | 'online';

const CPU_NAMES = ['番組AD', '座敷童子', 'プロデューサー', '敏腕ディレクター', '放送作家'];
const STORAGE_NAME = 'denki-isu:player-name';

interface Query {
  mode: Mode;
  name: string;
  seed: string;
  attacker: 0 | 1 | undefined;
  botDelay: number;
  room: string | null;
}

function parseQuery(): Query {
  const params = new URLSearchParams(window.location.search);
  const embedded = window.parent !== window;
  const rawMode = params.get('mode');
  const mode: Mode =
    rawMode === 'solo' || rawMode === 'online' ? rawMode : embedded ? 'online' : 'title';
  const attackerParam = params.get('attacker');
  return {
    mode,
    name: params.get('name') ?? defaultName(),
    seed: params.get('seed') ?? 'local',
    attacker: attackerParam === '0' ? 0 : attackerParam === '1' ? 1 : undefined,
    botDelay: Number(params.get('botDelay') ?? '500'),
    room: params.get('room'),
  };
}

function keyToChair(key: string): number | null {
  if (key.length === 1 && key >= '1' && key <= '9') return Number(key);
  if (key === '0') return 10;
  if (key === '-') return 11;
  if (key === '=' || key === '+') return 12;
  return null;
}

function defaultName(): string {
  try {
    const saved = localStorage.getItem(STORAGE_NAME);
    if (saved) return saved;
  } catch {
    // ignore
  }
  return `プレイヤー${Math.floor(Math.random() * 9000 + 1000)}`;
}

/**
 * Application shell: wires the 3D theatre, DOM overlay, Flaxia bridge and the
 * authoritative match session together.
 */
export class App {
  private readonly query = parseQuery();
  private readonly theater: Theater;
  private readonly ui: GameUI;
  private readonly canvas: HTMLCanvasElement;

  private session: MatchSession | null = null;
  private soloHost: MatchSession | null = null;
  private soloGuest: MatchSession | null = null;
  private soloBus: MemoryBus | null = null;
  private detachBot: (() => void) | null = null;
  private transports: Transport[] = [];
  private client: FlaxiaClient | null = null;
  private clientUnsubscribers: Array<() => void> = [];
  private mode: Mode = 'title';
  private matchId: string | null = null;
  private online = false;
  private unlockBound = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastCutInTurn = -1;
  private lastPhase: string | null = null;
  private lastViewTurn = -1;
  private lastRoundCalled = -1;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.theater = new Theater(canvas, {
      onChairPick: (chair) => this.onChairPick(chair),
      onFlash: (kind) => this.ui.flash(kind),
    });
    this.ui = new GameUI(uiRoot, {
      onSolo: () => void this.startSolo(),
      onOnline: () => void this.startOnline(),
      onRules: () => this.ui.showRules(),
      onBackToTitle: () => this.backToTitle(),
      onReady: (ready) => this.client?.setReady(ready),
      onStart: () => this.client?.startGame(),
      onCreateRoom: () => this.createOnlineRoom(),
      onJoinRoom: (roomId) => this.joinOnlineRoom(roomId),
      onLeave: () => this.leave(),
      onPreviewChair: (chair) => this.previewChair(chair),
      onConfirmChair: (chair) => this.confirmChair(chair),
      onPress: () => this.pressButton(),
      onAdvance: () => this.session?.advance(),
      onRematch: () => this.rematch(),
      onForfeit: () => this.forfeit(),
      onChat: (message) => this.client?.sendChat(message),
      onToggleSound: () => {
        const muted = this.theater.audio.toggleMuted();
        if (!muted && this.mode === 'title') void this.theater.audio.playBgm();
        return muted;
      },
      onFullscreen: () => this.client?.requestFullscreen(),
      onSubmitScore: (score, label) => {
        if (this.online) this.client?.submitScore(score, label);
      },
    });
  }

  async init(): Promise<void> {
    this.ui.showLoading(0.02, 'ステージを準備しています');
    try {
      await this.theater.build({
        onProgress: (progress) => {
          const ratio = progress.total > 0 ? progress.loaded / progress.total : 0;
          this.ui.updateLoading(ratio, progress.label);
        },
      });
    } catch (error) {
      console.error('stage build failed', error);
    }
    if (new URLSearchParams(window.location.search).get('avatar') === '1') {
      void this.theater.loadAvatars();
      this.theater.setAvatarsVisible(true);
    }
    this.ui.showTitle({
      canOnline: window.parent !== window,
      muted: this.theater.audio.isMuted,
      embedded: window.parent !== window,
    });

    this.bindAudioUnlock();

    if (this.query.mode === 'solo') {
      await this.startSolo();
    } else if (this.query.mode === 'online') {
      await this.startOnline();
    }

    window.addEventListener('beforeunload', () => this.dispose());
    window.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const view = this.session?.view;
    if (!view) return;
    const isAttacker = view.attacker === view.you;
    const canSet = view.phase === 'set' && isAttacker && !view.wiredCommitted;
    const canSit = view.phase === 'sit' && !isAttacker && view.sittingChair === null;

    if (event.key === 'Enter') {
      if (view.phase === 'result') {
        event.preventDefault();
        if (!this.ui.canAdvanceResult) return;
        this.session?.advance();
        return;
      }
      if (view.phase === 'press' && isAttacker) {
        event.preventDefault();
        if (!this.ui.canPressNow) return;
        this.pressButton();
        return;
      }
      if ((canSet || canSit) && this.ui.pending !== null) {
        event.preventDefault();
        this.confirmChair(this.ui.pending);
      }
      return;
    }

    const chair = keyToChair(event.key);
    if (chair === null || (!canSet && !canSit)) return;
    if (!view.availableChairs.includes(chair)) return;
    event.preventDefault();
    this.theater.audio.play('click');
    this.previewChair(chair);
  };

  // ------------------------------------------------------------------ modes

  private bindAudioUnlock(): void {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const unlock = (): void => {
      this.theater.audio.unlock();
      if (this.mode === 'title') void this.theater.audio.playBgm();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  private async startSolo(): Promise<void> {
    this.resetSession();
    this.mode = 'solo';
    this.online = false;
    this.theater.audio.unlock();
    this.theater.audio.stopBgm(300);
    this.theater.audio.stopHeartbeat();
    this.theater.setIdle(false);
    this.theater.resetInteractions();
    this.theater.setAvatarsVisible(false);

    const you: PlayerIdentity = { id: 'you', name: this.query.name };
    const cpu: PlayerIdentity = {
      id: 'cpu',
      name: CPU_NAMES[Math.floor(Math.random() * CPU_NAMES.length)] ?? 'CPU',
    };
    const players = [you, cpu] as const;

    const bus = new MemoryBus();
    const hostTransport = bus.addPeer('you', 'you');
    const guestTransport = bus.addPeer('cpu', 'you');
    this.soloBus = bus;
    this.transports.push(hostTransport, guestTransport);

    const host = new MatchSession({
      transport: hostTransport,
      selfId: 'you',
      players,
      isHost: true,
      startingAttacker: this.query.attacker,
      timers: true,
    });
    const guest = new MatchSession({
      transport: guestTransport,
      selfId: 'cpu',
      players,
      isHost: false,
      timers: true,
    });
    this.soloHost = host;
    this.soloGuest = guest;
    this.session = host;
    this.detachBot = attachBot(guest, {
      delayMs: Math.max(0, Number.isFinite(this.query.botDelay) ? this.query.botDelay : 500),
      timers: true,
      seed: `${this.query.seed}:bot`,
      autoRematch: true,
    });

    host.on('view', (view) => this.handleView(view, { online: false, roomId: null }));
    host.on('error', (error) => this.ui.showToast(`${error.code}: ${error.message}`));

    const initial = host.view;
    if (initial) this.handleView(initial, { online: false, roomId: null });
  }

  private async startOnline(): Promise<void> {
    this.mode = 'online';
    this.online = true;
    if (window.parent === window) {
      this.ui.showTitle({ canOnline: false, muted: this.theater.audio.isMuted, embedded: false });
      this.ui.showToast('オンライン対戦は Flaxia 上で起動してください');
      return;
    }
    this.theater.audio.unlock();
    this.theater.setAvatarsVisible(false);
    this.ui.showRoomEntry({ initialRoomId: this.query.room ?? null });
    this.ensureClient();
    if (this.query.room) this.joinOnlineRoom(this.query.room);
  }

  /** 新規ルームを作成する（Flaxia 親が空きルームを割り当てる）。 */
  private createOnlineRoom(): void {
    this.ensureClient();
    if (!this.client) return;
    this.ui.setRoomEntryError(null);
    this.ui.setRoomEntryBusy(true);
    this.client.createRoom();
  }

  /** 既存のルームIDへ参加する。 */
  private joinOnlineRoom(roomId: string): void {
    this.ensureClient();
    if (!this.client) return;
    this.ui.setRoomEntryError(null);
    this.ui.setRoomEntryBusy(true);
    this.client.joinRoom(roomId);
  }

  private ensureClient(): void {
    if (this.client) return;
    const client = new FlaxiaClient({
      gameId: GAME_ID,
      roomId: this.query.room ?? undefined,
      autoConnect: false,
    });
    this.client = client;

    this.clientUnsubscribers.push(
      client.on('onRoomState', () => {
        this.refreshLobby();
        const room = client.currentRoom;
        if (room?.status === 'playing' && client.players.length >= 2) {
          this.startOnlineSession();
        }
      }),
      client.on('onPlayerJoined', () => this.refreshLobby()),
      client.on('onPlayerLeft', (userId) => {
        this.refreshLobby();
        if (this.session) {
          this.ui.showToast('相手が退出しました');
          this.leave();
        } else {
          this.ui.showToast('プレイヤーが退出しました', 'info');
        }
        void userId;
      }),
      client.on('onPlayerReady', () => this.refreshLobby()),
      client.on('onGameStart', () => this.startOnlineSession()),
      client.on('onChat', (event) => {
        this.ui.addChat({ name: event.username || '相手', text: event.message });
      }),
      client.on('onError', (error) => {
        if (
          !this.session &&
          (error.code === 'ROOM_JOIN_FAILED' ||
            error.code === 'INVALID_ROOM_ID' ||
            error.code === 'ROOM_FULL')
        ) {
          this.ui.setRoomEntryBusy(false);
          this.ui.setRoomEntryError(error.message);
        } else {
          this.ui.showToast(`${error.code}: ${error.message}`);
        }
      }),
      client.on('onDisconnect', () => {
        this.ui.showToast('接続が切れました');
        this.ui.setRoomEntryBusy(false);
        if (this.session) this.leave();
      }),
      client.on('onHostChanged', () => {
        this.ui.showToast('ホストが変更されました。再入室してください');
      }),
      client.on('onIdentity', () => this.refreshLobby()),
      client.on('onFullscreen', (granted) => {
        if (!granted) this.ui.showToast('フルスクリーンにできませんでした');
      }),
    );
  }

  private refreshLobby(): void {
    if (!this.client || this.online === false) return;
    if (this.session) return;
    const players = this.client.players.map((player) => ({
      id: player.userId,
      name: player.displayName || player.username || 'プレイヤー',
      isHost: player.isHost || player.userId === this.client?.hostId,
      isReady: player.isReady,
    }));
    const youId = this.client.selfId;
    const isHost = this.client.isHost;
    const canStart = isHost && players.length >= 2 && players.every((player) => player.isReady);
    const status: LobbyState['status'] = players.length >= 2 ? 'lobby' : 'waiting';
    this.ui.showLobby({
      roomId: this.client.currentRoomId,
      players,
      youId,
      isHost,
      canStart,
      status,
    });
  }

  private startOnlineSession(): void {
    if (!this.client || this.session) return;
    const client = this.client;
    const roomPlayers = client.players;
    if (roomPlayers.length < 2) return;
    const hostId = client.hostId;
    const selfId = client.selfId;
    if (!hostId || !selfId) {
      this.ui.showToast('プレイヤーIDを特定できません。再入室してください');
      return;
    }
    const ordered = [...roomPlayers].sort((a, b) => {
      if (a.userId === hostId) return -1;
      if (b.userId === hostId) return 1;
      return a.userId.localeCompare(b.userId);
    });
    const first = ordered[0];
    const second = ordered[1];
    if (!first || !second) return;
    const players: [PlayerIdentity, PlayerIdentity] = [
      { id: first.userId, name: first.displayName || first.username || 'ホスト' },
      { id: second.userId, name: second.displayName || second.username || 'ゲスト' },
    ];
    this.theater.audio.stopBgm(400);
    this.theater.audio.stopHeartbeat();
    const transport = new FlaxiaTransport(client, selfId, hostId);
    this.transports.push(transport);
    const session = new MatchSession({
      transport,
      selfId,
      players,
      isHost: selfId === hostId,
      timers: true,
    });
    this.session = session;
    session.on('view', (view) =>
      this.handleView(view, { online: true, roomId: client.currentRoomId }),
    );
    session.on('error', (error) => {
      this.ui.showToast(`${error.code}: ${error.message}`);
    });
    session.on('rematch', () => this.ui.showToast('再戦が始まります', 'info'));

    this.matchId = null;
    this.ensureSyncRequest();
    const view = session.view;
    if (view) this.handleView(view, { online: true, roomId: client.currentRoomId });
  }

  private ensureSyncRequest(): void {
    if (this.syncTimer !== null) return;
    let attempts = 0;
    this.syncTimer = setInterval(() => {
      attempts += 1;
      if (!this.session || this.session.view || attempts > 8) {
        if (this.syncTimer !== null) clearInterval(this.syncTimer);
        this.syncTimer = null;
        return;
      }
      this.session.requestSync();
    }, 1_000);
  }

  // ------------------------------------------------------------------ views

  private handleView(view: MatchView, options: { online: boolean; roomId: string | null }): void {
    if (view.phase !== 'sit') this.ui.cancelFinalThunder();
    const newMatch = this.matchId !== view.matchId;
    this.matchId = view.matchId;
    if (newMatch) {
      this.lastCutInTurn = -1;
      this.lastPhase = null;
      this.lastViewTurn = -1;
      this.lastRoundCalled = -1;
      this.theater.audio.stopBgm(350);
      this.theater.audio.preloadRounds();
      void this.theater.audio.playGameBgm(0.22);
      this.theater.resetInteractions();
      this.theater.setIdle(false);
      this.ui.showGame(view, options);
    }
    const isAttacker = view.attacker === view.you;
    const canSelect =
      (view.phase === 'set' && isAttacker && !view.wiredCommitted) ||
      (view.phase === 'sit' && !isAttacker && view.sittingChair === null);
    if (
      view.turn !== this.lastViewTurn ||
      view.phase !== this.lastPhase ||
      view.phase === 'press' ||
      view.phase === 'result' ||
      view.phase === 'finished' ||
      (view.phase === 'sit' && view.sittingChair !== null)
    ) {
      this.theater.setSelected(null);
    }
    this.lastViewTurn = view.turn;
    this.ui.updateView(view);
    this.theater.applyView(view);
    if (view.phase === 'press' && this.lastPhase !== 'press') {
      void this.theater.audio.playHeartbeat(true);
    } else if (view.phase !== 'press' && this.lastPhase === 'press') {
      this.theater.audio.stopHeartbeat();
    }
    if (view.phase === 'result' && view.lastResult) {
      const result = view.lastResult;
      if (result.hit && this.lastCutInTurn !== result.turn) {
        this.lastCutInTurn = result.turn;
        this.ui.playCutIn(view.outcome?.reason === 'shocks' ? 'final-thunder' : 'lightning');
      }
    }
    this.lastPhase = view.phase;
    if (newMatch || view.turn !== this.lastRoundCalled) {
      this.lastRoundCalled = view.turn;
      this.ui.showRoundCall(view.turn, view.config.maxTurns, () =>
        this.theater.audio.announceRound(view.turn),
      );
    }
    this.theater.setEnabled(canSelect);
    this.theater.setButtonActive(view.phase === 'press' && isAttacker);
    if (view.phase === 'finished' && view.outcome?.kind === 'win') {
      this.theater.audio.stopHeartbeat();
    }
    if (view.phase === 'finished') {
      this.theater.audio.stopGameBgm(1200);
      this.theater.audio.stopHeartbeat();
      this.theater.audio.stopRoundVoice();
    }
  }

  private previewChair(chair: number | null): void {
    const view = this.session?.view;
    if (!view) return;
    const isAttacker = view.attacker === view.you;
    const canChoose =
      (view.phase === 'set' && isAttacker && !view.wiredCommitted) ||
      (view.phase === 'sit' && !isAttacker && view.sittingChair === null);
    if (!canChoose) return;
    this.theater.setSelected(chair);
    this.ui.setPendingChair(chair);
  }

  private onChairPick(chair: number): void {
    const view = this.session?.view;
    if (!view) return;
    const isAttacker = view.attacker === view.you;
    const canChoose =
      (view.phase === 'set' && isAttacker && !view.wiredCommitted) ||
      (view.phase === 'sit' && !isAttacker && view.sittingChair === null);
    if (!canChoose) return;
    this.theater.audio.play('click');
    this.previewChair(this.ui.pending === chair ? null : chair);
  }

  private confirmChair(chair: number): void {
    if (!this.session) return;
    const view = this.session.view;
    if (view?.phase === 'sit' && view.attacker !== view.you) {
      void this.confirmSittingChair(chair);
      return;
    }
    this.commitChair(chair);
  }

  /**
   * 守備側の着席確定。実写の「ファイナルサンダー？」と同じく、
   * 席を変えるか、このまま確定するかを選んでから sit を送る。
   */
  private async confirmSittingChair(chair: number): Promise<void> {
    if (!this.session) return;
    const view = this.session.view;
    if (!view) return;
    this.ui.setLocalActionPending(true);
    this.theater.audio.play('click');
    // ファイナルサンダーのカットイン中から、この椅子に座った姿を見せる。
    this.theater.previewSitting(chair);
    const choice = await this.ui.askFinalThunder(chair, view.players[view.you].name);
    const current = this.session?.view;
    if (!current) return;
    if (current.phase !== 'sit') {
      this.ui.setLocalActionPending(false);
      return;
    }
    if (choice === 'change') {
      this.theater.previewSitting(null);
      this.ui.setLocalActionPending(false);
      this.ui.setPendingChair(null);
      this.theater.setSelected(null);
      this.theater.setEnabled(true);
      this.ui.openChairDrawer();
      this.ui.showToast('席を変えて、もう一度選んでください', 'info');
      return;
    }
    this.commitChair(chair);
  }

  private commitChair(chair: number): void {
    if (!this.session) return;
    const result = this.session.chooseChair(chair);
    if (!result.ok) {
      this.theater.previewSitting(null);
      this.ui.showToast(result.message ?? '選択できません');
      return;
    }
    this.theater.audio.play('click');
    this.ui.setLocalActionPending(true);
    this.ui.setPendingChair(null);
    this.theater.setSelected(null);
    this.theater.setEnabled(false);
  }

  private pressButton(): void {
    if (!this.session) return;
    const result = this.session.pressButton();
    if (!result.ok) {
      this.ui.showToast(result.message ?? 'ボタンを押せません');
      return;
    }
    this.theater.audio.play('click');
    this.ui.setLocalActionPending(true);
    this.theater.setButtonActive(false);
  }

  private rematch(): void {
    this.session?.rematch();
    this.ui.showToast('再戦の準備をしました。相手を待っています…', 'info');
  }

  private forfeit(): void {
    this.session?.forfeit();
    this.ui.showToast('降参しました');
  }

  private leave(): void {
    this.resetSession();
    this.ui.cancelFinalThunder();
    this.theater.audio.stopHeartbeat();
    this.theater.audio.stopGameBgm(300);
    this.theater.audio.stopRoundVoice();
    this.ui.clearRoundCall();
    this.theater.setIdle(true);
    this.theater.resetInteractions();
    this.theater.setAvatarsVisible(true);
    this.matchId = null;
    if (this.client) {
      this.client.disconnect();
      for (const unsubscribe of this.clientUnsubscribers) unsubscribe();
      this.clientUnsubscribers = [];
      this.client.destroy();
      this.client = null;
    }
    this.mode = 'title';
    this.online = false;
    if (new URLSearchParams(window.location.search).get('avatar') === '1') {
      void this.theater.loadAvatars();
      this.theater.setAvatarsVisible(true);
    }
    this.ui.showTitle({
      canOnline: window.parent !== window,
      muted: this.theater.audio.isMuted,
      embedded: window.parent !== window,
    });
    this.theater.audio.playBgm();
  }

  private backToTitle(): void {
    this.leave();
  }

  private resetSession(): void {
    this.detachBot?.();
    this.detachBot = null;
    this.soloHost?.dispose();
    this.soloHost = null;
    this.soloGuest?.dispose();
    this.soloGuest = null;
    if (this.soloBus) {
      for (const transport of this.transports) transport.close();
      this.transports = [];
      this.soloBus = null;
    }
    this.session?.dispose();
    this.session = null;
    for (const transport of this.transports) transport.close();
    this.transports = [];
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.matchId = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resetSession();
    this.client?.destroy();
    this.theater.dispose();
    this.ui.dispose();
    this.canvas.remove();
  }
}
