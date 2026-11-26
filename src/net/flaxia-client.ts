/**
 * A small, dependency-free implementation of the Flaxia postMessage contract.
 *
 * The official `@flaxia/game-sdk` is not published on npm, and the game must
 * work with the platform's injected `/sdk/game.js` as well. Keeping our own
 * typed client lets us exercise the exact wire protocol in the local harness.
 * See docs/game-api.md and docs/multiplayer.md.
 */
import { Emitter } from './emitter';

export interface PlayerInfo {
  userId: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
  isReady: boolean;
  isHost: boolean;
}

export interface RoomInfo {
  roomId: string;
  gameId: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  maxPlayers: number;
  isPublic: boolean;
  createdAt: number;
}

export interface RoomState {
  room: RoomInfo;
  players: PlayerInfo[];
}

export interface GameStateEvent {
  gameId: string;
  state: unknown;
  timestamp: number;
}

export interface PlayerInputEvent {
  userId: string;
  input: unknown;
}

export interface ChatEvent {
  userId: string;
  username: string;
  message: string;
}

export interface GameOverEvent {
  winner?: string;
  scores?: Record<string, number>;
}

export interface MultiplayerError {
  code: string;
  message: string;
}

export interface P2PStateEvent {
  state: 'connected' | 'disconnected' | 'failed';
  peerId?: string;
}

export interface PeerDataEvent {
  data: unknown;
}

export interface PlayerIdentity {
  userId: string | null;
  username: string | null;
  displayName: string | null;
  avatarKey: string | null;
  equippedTitle: {
    id: string;
    name: string;
    nameJa: string;
    description: string;
    descriptionJa: string;
    icon: string;
  } | null;
}

export interface FlaxiaEventMap {
  onRoomState: RoomState;
  onPlayerJoined: PlayerInfo;
  onPlayerLeft: string;
  onPlayerReady: { userId: string; ready: boolean };
  onGameStart: void;
  onGameState: GameStateEvent;
  onPlayerInput: PlayerInputEvent;
  onGameOver: GameOverEvent;
  onHostChanged: string;
  onChat: ChatEvent;
  onError: MultiplayerError;
  onDisconnect: void;
  onP2PState: P2PStateEvent;
  onPeerData: PeerDataEvent;
  onIdentity: PlayerIdentity;
  onScoreSubmitted: { score: number; label: string };
  onFullscreen: boolean;
  onFresh: boolean;
}

export interface FlaxiaClientOptions {
  gameId: string;
  roomId?: string;
  autoConnect?: boolean;
  /** Default: parent origin (document.referrer), flaxia.app, and localhost. */
  allowedOrigins?: string[];
}

interface ParentFrame {
  type: string;
  [key: string]: unknown;
}

export const ROOM_ID_MIN_LENGTH = 4;
export const ROOM_ID_MAX_LENGTH = 128;

const ROOM_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Normalize a user-entered room ID.
 *
 * - trims surrounding whitespace
 * - preserves case (Flaxia room IDs can be case-sensitive)
 * - requires 4-128 characters of `[A-Za-z0-9._:-]`
 *
 * Returns `null` when the value cannot be a room ID. Keep this in sync with
 * `src/ui/room-id.ts` (the input sanitizer uses the same rules).
 */
export function normalizeRoomId(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length < ROOM_ID_MIN_LENGTH || normalized.length > ROOM_ID_MAX_LENGTH) {
    return null;
  }
  if (!ROOM_ID_PATTERN.test(normalized)) return null;
  return normalized;
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://flaxia.app',
  'https://*.flaxia.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

function matchOrigin(origin: string, allowed: string): boolean {
  if (allowed === origin) return true;
  if (!allowed.includes('*')) return false;
  const escaped = allowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(origin);
}

function parentOriginFromReferrer(): string | null {
  try {
    if (!document.referrer) return null;
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}

/**
 * Client for the Flaxia iframe bridge. Handles the multiplexed protocol
 * (`type` frames) and exposes the `MultiplayerClient`-shaped event names from
 * docs/sdk.md.
 */
export class FlaxiaClient {
  readonly gameId: string;

  private readonly emitter = new Emitter<FlaxiaEventMap>();
  private requestedRoomIdValue: string | null;
  private pendingRoomId: string | null = null;
  private readonly parent: Window;
  private readonly targetOrigin: string;
  private readonly allowedOrigins: string[];
  private readonly messageHandler: (event: MessageEvent) => void;
  private roomState: RoomState | null = null;
  private connected = false;
  private pendingStart = false;
  private inferredHost: boolean | null = null;
  private frameSelfId: string | null = null;
  private identityUserId: string | null = null;
  private identity: PlayerIdentity | null = null;
  private identityRequested = false;
  private disposed = false;

  constructor(options: FlaxiaClientOptions) {
    if (!options.gameId) throw new Error('gameId is required');
    this.gameId = options.gameId;
    this.requestedRoomIdValue = options.roomId ?? null;
    this.parent = window.parent;

    const referrerOrigin = parentOriginFromReferrer();
    const allowed = options.allowedOrigins ?? [
      ...(referrerOrigin ? [referrerOrigin] : []),
      ...DEFAULT_ALLOWED_ORIGINS,
    ];
    this.allowedOrigins = [...new Set(allowed.filter(Boolean))];

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      this.targetOrigin = window.location.origin;
    } else {
      this.targetOrigin = referrerOrigin ?? 'https://flaxia.app';
    }

    this.messageHandler = (event) => this.handleMessage(event);
    window.addEventListener('message', this.messageHandler);

    if (options.autoConnect !== false) this.connect(options.roomId);
  }

  // ---------------------------------------------------------------- getters

  get isConnected(): boolean {
    return this.connected;
  }

  /** Last room ID this client asked for (normalized for `joinRoom`). */
  get requestedRoomId(): string | null {
    return this.requestedRoomIdValue;
  }

  get currentRoomId(): string | null {
    return this.roomState?.room.roomId ?? this.pendingRoomId ?? this.requestedRoomIdValue;
  }

  get currentRoom(): RoomInfo | null {
    return this.roomState?.room ?? null;
  }

  get players(): PlayerInfo[] {
    return this.roomState?.players ?? [];
  }

  get hostId(): string | null {
    return this.roomState?.room.hostId ?? null;
  }

  /** Best-effort local player id, inferred from identity/host signals. */
  get selfId(): string | null {
    if (this.frameSelfId) return this.frameSelfId;
    if (this.identityUserId) {
      const match = this.players.find((player) => player.userId === this.identityUserId);
      if (match) return match.userId;
    }
    const hostId = this.hostId;
    if (!hostId) return null;
    if (this.inferredHost === true) return hostId;
    if (this.inferredHost === false && this.players.length === 2) {
      return this.players.find((player) => player.userId !== hostId)?.userId ?? null;
    }
    return null;
  }

  get isHost(): boolean {
    if (this.frameSelfId && this.hostId) return this.frameSelfId === this.hostId;
    if (this.identityUserId && this.hostId) return this.identityUserId === this.hostId;
    return this.inferredHost === true;
  }

  get identityInfo(): PlayerIdentity | null {
    return this.identity;
  }

  get isEmbedded(): boolean {
    return this.parent !== window;
  }

  // ------------------------------------------------------------------ events

  on<K extends keyof FlaxiaEventMap>(
    event: K,
    handler: (payload: FlaxiaEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(event, handler);
  }

  // --------------------------------------------------------------- commands

  /**
   * Connect to a room. Omit `roomId` to create a room. Kept for backwards
   * compatibility; new UI code should call `createRoom()` / `joinRoom()`.
   */
  connect(roomId?: string): void {
    if (roomId !== undefined) {
      this.requestedRoomIdValue = roomId;
      this.pendingRoomId = roomId;
    }
    this.postConnect(roomId ?? this.requestedRoomIdValue);
  }

  /** Leave any current room and ask the parent to create a new one. */
  createRoom(): void {
    this.requestedRoomIdValue = null;
    this.pendingRoomId = null;
    this.resetRoomState();
    this.postConnect(null);
  }

  /**
   * Join an existing room by ID. The ID is trimmed (case preserved); invalid
   * values emit `INVALID_ROOM_ID` locally and are never sent to the parent.
   */
  joinRoom(roomId: string): void {
    const normalized = normalizeRoomId(roomId);
    if (normalized === null) {
      this.emitter.emit('onError', {
        code: 'INVALID_ROOM_ID',
        message:
          'ルームIDは4〜128文字の英数字・ハイフン・アンダースコア・ドット・コロンで入力してください',
      });
      return;
    }
    this.requestedRoomIdValue = normalized;
    this.pendingRoomId = normalized;
    this.resetRoomState();
    this.postConnect(normalized);
  }

  disconnect(): void {
    this.post({ type: 'MULTIPLAYER_DISCONNECT' });
    this.connected = false;
    this.roomState = null;
  }

  startGame(): void {
    this.pendingStart = true;
    this.post({ type: 'MULTIPLAYER_START_GAME' });
  }

  setReady(ready: boolean): void {
    this.post({ type: 'MULTIPLAYER_SET_READY', ready });
  }

  sendChat(message: string): void {
    this.post({ type: 'MULTIPLAYER_CHAT', message: message.slice(0, 500) });
  }

  requestState(): void {
    this.post({ type: 'MULTIPLAYER_REQUEST_STATE' });
  }

  sendPeerData(data: unknown): void {
    this.post({ type: 'MULTIPLAYER_SEND_PEER_DATA', data });
  }

  sendInput(input: unknown): void {
    this.post({ type: 'MULTIPLAYER_INPUT', input });
  }

  requestIdentity(): void {
    this.post({ type: 'REQUEST_IDENTITY' });
  }

  requestFullscreen(): void {
    this.post({ type: 'REQUEST_FULLSCREEN' });
  }

  requestFresh(): void {
    this.post({ type: 'REQUEST_FRESH' });
  }

  submitScore(score: number, label = ''): void {
    if (!Number.isFinite(score)) return;
    this.post({ type: 'POST_SCORE', score, label: label.slice(0, 64) });
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.emitter.clear();
    window.removeEventListener('message', this.messageHandler);
    try {
      this.disconnect();
    } catch {
      // ignore
    }
  }

  // --------------------------------------------------------------- internals

  private postConnect(roomId: string | null): void {
    this.post({
      type: 'MULTIPLAYER_CONNECT',
      gameId: this.gameId,
      ...(roomId ? { roomId } : {}),
    });
  }

  /** Drop local room state so a room switch cannot leak the previous roster. */
  private resetRoomState(): void {
    this.roomState = null;
    this.connected = false;
    this.pendingStart = false;
    this.frameSelfId = null;
    this.inferredHost = null;
  }

  private post(frame: ParentFrame): void {
    if (this.parent === window) {
      this.emitter.emit('onError', {
        code: 'DISCONNECTED',
        message: 'Flaxia の親フレームが見つかりません',
      });
      return;
    }
    this.parent.postMessage(frame, this.targetOrigin);
  }

  private isAllowedOrigin(origin: string): boolean {
    if (origin === window.location.origin) return true;
    return this.allowedOrigins.some((allowed) => matchOrigin(origin, allowed));
  }

  private payload(frame: ParentFrame): Record<string, unknown> {
    const nested = frame.payload;
    if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
    return frame;
  }

  private handleMessage(event: MessageEvent): void {
    if (event.source !== this.parent) return;
    if (!this.isAllowedOrigin(event.origin)) return;
    const data = event.data as ParentFrame | undefined;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    const frame = data;
    const payload = this.payload(frame);

    switch (frame.type) {
      case 'MULTIPLAYER_ROOM_STATE': {
        const room = (payload.room ?? frame.room) as RoomInfo | undefined;
        const players = (payload.players ?? frame.players) as PlayerInfo[] | undefined;
        if (!room || !players) return;
        this.roomState = { room, players };
        this.connected = true;
        this.pendingRoomId = null;
        const explicitSelf = payload.selfId ?? payload.you ?? frame.selfId ?? frame.you ?? null;
        if (typeof explicitSelf === 'string') this.frameSelfId = explicitSelf;
        // The host is the only player allowed to start; if the room already
        // says we are the host by identity, record it.
        if (this.identityUserId && room.hostId === this.identityUserId) this.inferredHost = true;
        if (this.frameSelfId) this.inferredHost = this.frameSelfId === room.hostId;
        this.emitter.emit('onRoomState', this.roomState);
        // Identity helps determine selfId and is harmless to request once.
        if (!this.identityRequested) {
          this.identityRequested = true;
          this.requestIdentity();
        }
        break;
      }
      case 'MULTIPLAYER_PLAYER_JOINED': {
        const player = (payload.player ?? frame.player) as PlayerInfo | undefined;
        if (!player || !this.roomState) return;
        if (!this.roomState.players.some((p) => p.userId === player.userId)) {
          this.roomState = {
            ...this.roomState,
            players: [...this.roomState.players, player],
          };
        }
        this.emitter.emit('onPlayerJoined', player);
        if (this.roomState) this.emitter.emit('onRoomState', this.roomState);
        break;
      }
      case 'MULTIPLAYER_PLAYER_LEFT': {
        const userId = String(payload.userId ?? frame.userId ?? '');
        if (!this.roomState || !userId) return;
        this.roomState = {
          ...this.roomState,
          players: this.roomState.players.filter((p) => p.userId !== userId),
        };
        this.emitter.emit('onPlayerLeft', userId);
        this.emitter.emit('onRoomState', this.roomState);
        break;
      }
      case 'MULTIPLAYER_PLAYER_READY': {
        const userId = String(payload.userId ?? '');
        const ready = Boolean(payload.ready);
        if (this.roomState) {
          this.roomState = {
            ...this.roomState,
            players: this.roomState.players.map((p) =>
              p.userId === userId ? { ...p, isReady: ready } : p,
            ),
          };
          this.emitter.emit('onRoomState', this.roomState);
        }
        this.emitter.emit('onPlayerReady', { userId, ready });
        break;
      }
      case 'MULTIPLAYER_GAME_START': {
        if (this.roomState) {
          this.roomState = {
            ...this.roomState,
            room: { ...this.roomState.room, status: 'playing' },
          };
        }
        this.inferredHost = this.pendingStart;
        this.pendingStart = false;
        this.emitter.emit('onGameStart', undefined);
        break;
      }
      case 'MULTIPLAYER_GAME_OVER': {
        this.emitter.emit('onGameOver', {
          winner: typeof payload.winner === 'string' ? payload.winner : undefined,
          scores:
            payload.scores && typeof payload.scores === 'object'
              ? (payload.scores as Record<string, number>)
              : undefined,
        });
        break;
      }
      case 'MULTIPLAYER_STATE': {
        this.emitter.emit('onGameState', {
          gameId: String(payload.gameId ?? this.gameId),
          state: payload.state,
          timestamp: Number(payload.timestamp ?? Date.now()),
        });
        break;
      }
      case 'MULTIPLAYER_PLAYER_INPUT': {
        this.emitter.emit('onPlayerInput', {
          userId: String(payload.userId ?? ''),
          input: payload.input,
        });
        break;
      }
      case 'MULTIPLAYER_HOST_CHANGED': {
        const newHostId = String(payload.newHostId ?? '');
        if (this.roomState && newHostId) {
          this.roomState = {
            ...this.roomState,
            room: { ...this.roomState.room, hostId: newHostId },
          };
          const knownSelf = this.frameSelfId ?? this.identityUserId;
          this.inferredHost = knownSelf ? knownSelf === newHostId : null;
        }
        this.emitter.emit('onHostChanged', newHostId);
        break;
      }
      case 'MULTIPLAYER_P2P_STATE': {
        this.emitter.emit('onP2PState', {
          state: (payload.state as P2PStateEvent['state']) ?? 'disconnected',
          peerId: typeof payload.peerId === 'string' ? payload.peerId : undefined,
        });
        break;
      }
      case 'MULTIPLAYER_PEER_DATA': {
        this.emitter.emit('onPeerData', { data: payload.data });
        break;
      }
      case 'MULTIPLAYER_CHAT': {
        this.emitter.emit('onChat', {
          userId: String(payload.userId ?? ''),
          username: String(payload.username ?? ''),
          message: String(payload.message ?? ''),
        });
        break;
      }
      case 'MULTIPLAYER_ERROR': {
        const code = String(payload.code ?? 'CONNECTION_ERROR');
        if (code === 'ROOM_JOIN_FAILED') {
          // Let the UI retry from a clean slate: createRoom() / joinRoom()
          // must not fall back to the rejected ID.
          this.pendingRoomId = null;
          this.requestedRoomIdValue = null;
          this.connected = false;
          this.roomState = null;
        }
        this.emitter.emit('onError', {
          code,
          message: String(payload.message ?? ''),
        });
        break;
      }
      case 'MULTIPLAYER_DISCONNECT': {
        this.connected = false;
        this.roomState = null;
        this.pendingRoomId = null;
        this.emitter.emit('onDisconnect', undefined);
        break;
      }
      case 'PLAYER_IDENTITY': {
        this.identity = payload.identity as PlayerIdentity;
        this.identityUserId = this.identity.userId;
        if (this.identityUserId && this.hostId === this.identityUserId) this.inferredHost = true;
        this.emitter.emit('onIdentity', this.identity);
        break;
      }
      case 'SCORE_SUBMITTED': {
        this.emitter.emit('onScoreSubmitted', {
          score: Number(payload.score ?? 0),
          label: String(payload.label ?? ''),
        });
        break;
      }
      case 'FULLSCREEN_GRANTED':
        this.emitter.emit('onFullscreen', true);
        break;
      case 'FULLSCREEN_DENIED':
        this.emitter.emit('onFullscreen', false);
        break;
      case 'FRESH_GRANTED':
        this.emitter.emit('onFresh', true);
        break;
      case 'FRESH_DENIED':
        this.emitter.emit('onFresh', false);
        break;
      default:
        break;
    }
  }
}
