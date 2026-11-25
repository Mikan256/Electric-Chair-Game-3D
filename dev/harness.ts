/**
 * A mock Flaxia parent for local development.
 *
 * It speaks the documented postMessage protocol so the real game client and
 * MatchSession run unchanged. Frames share a room and relay peer data, which
 * exercises the commit-reveal flow with genuinely separate documents.
 *
 * Rooms are kept in a small in-memory registry so "create room" (no roomId)
 * and "join with room ID" can both be exercised locally:
 * - `MULTIPLAYER_CONNECT` without a roomId joins the first lobby room with a
 *   free seat, or creates `LOCAL` / `ROOM2` / `ROOM3` ...
 * - `MULTIPLAYER_CONNECT { roomId }` joins that exact room or fails with
 *   `ROOM_JOIN_FAILED`.
 */
import { normalizeRoomId } from '../src/net/flaxia-client';

interface MockPlayer {
  userId: string;
  username: string;
  displayName: string;
  avatarKey: string | null;
  isReady: boolean;
  isHost: boolean;
}

interface RoomInfo {
  roomId: string;
  gameId: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  maxPlayers: number;
  isPublic: boolean;
  createdAt: number;
}

interface ClientSession {
  frame: HTMLIFrameElement;
  player: MockPlayer;
  roomId: string;
}

interface RoomRecord {
  info: RoomInfo;
  sessions: Map<HTMLIFrameElement, ClientSession>;
}

interface RoomSummary {
  room: RoomInfo;
  players: MockPlayer[];
}

interface HarnessApi {
  /** Default room (`LOCAL`), kept for backwards compatibility. */
  readonly room: RoomInfo;
  readonly players: MockPlayer[];
  readonly rooms: RoomSummary[];
  readonly activeRoomId: string;
  startGame: (roomId?: string) => void;
  setReady: (slot: 'a' | 'b', ready: boolean) => void;
  frame: (slot: 'a' | 'b') => HTMLIFrameElement;
  createRoom: (slot?: 'a' | 'b') => string;
  roomOf: (slot: 'a' | 'b') => string | null;
}

const GAME_ID = 'denki-isu-3d';
const DEFAULT_ROOM_ID = 'LOCAL';
const MAX_PLAYERS = 2;

const iframes: Record<'a' | 'b', HTMLIFrameElement> = {
  a: document.querySelector<HTMLIFrameElement>('#frame-a')!,
  b: document.querySelector<HTMLIFrameElement>('#frame-b')!,
};
const roomIdEl = document.querySelector<HTMLElement>('#room-id')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const playersEl = document.querySelector<HTMLElement>('#players')!;
const logEl = document.querySelector<HTMLElement>('#log')!;
const roomInput = document.querySelector<HTMLInputElement>('#room-input');
const roomJoinButton = document.querySelector<HTMLButtonElement>('#room-join');
const roomCreateButton = document.querySelector<HTMLButtonElement>('#room-create');
const roomErrorEl = document.querySelector<HTMLElement>('#room-error');

const rooms = new Map<string, RoomRecord>();
const sessions = new Map<HTMLIFrameElement, ClientSession>();
let counter = 0;
let activeRoomId = DEFAULT_ROOM_ID;

function createRoomRecord(roomId: string): RoomRecord {
  const record: RoomRecord = {
    info: {
      roomId,
      gameId: GAME_ID,
      hostId: '',
      status: 'lobby',
      maxPlayers: MAX_PLAYERS,
      isPublic: true,
      createdAt: Date.now(),
    },
    sessions: new Map(),
  };
  rooms.set(roomId, record);
  return record;
}

createRoomRecord(DEFAULT_ROOM_ID);

function defaultRoom(): RoomRecord {
  return rooms.get(DEFAULT_ROOM_ID) ?? createRoomRecord(DEFAULT_ROOM_ID);
}

function nextAutoRoomId(): string {
  if (!rooms.has(DEFAULT_ROOM_ID)) return DEFAULT_ROOM_ID;
  let index = 2;
  while (rooms.has(`ROOM${index}`)) index += 1;
  return `ROOM${index}`;
}

function log(message: string, kind: 'host' | 'peer' | 'info' = 'info'): void {
  const line = document.createElement('div');
  line.className = kind;
  line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 80) logEl.firstElementChild?.remove();
}

function setRoomError(message: string | null): void {
  if (!roomErrorEl) return;
  roomErrorEl.textContent = message ?? '';
  roomErrorEl.hidden = !message;
}

function send(frame: HTMLIFrameElement, framePayload: Record<string, unknown>): void {
  frame.contentWindow?.postMessage(framePayload, window.location.origin);
}

function broadcastRoom(
  room: RoomRecord,
  payload: Record<string, unknown>,
  except?: HTMLIFrameElement,
): void {
  for (const session of room.sessions.values()) {
    if (session.frame !== except) send(session.frame, payload);
  }
}

function playersIn(room: RoomRecord): MockPlayer[] {
  return [...room.sessions.values()].map((session) => session.player);
}

function roomStateFor(room: RoomRecord, session: ClientSession): Record<string, unknown> {
  return {
    type: 'MULTIPLAYER_ROOM_STATE',
    room: room.info,
    players: playersIn(room),
    selfId: session.player.userId,
  };
}

function syncHeader(): void {
  const room = rooms.get(activeRoomId) ?? defaultRoom();
  roomIdEl.textContent = room.info.roomId;
  statusEl.textContent = room.info.status;
  playersEl.textContent = `${room.sessions.size} / ${room.info.maxPlayers}`;
}

function broadcastRoomState(room: RoomRecord): void {
  for (const session of room.sessions.values()) send(session.frame, roomStateFor(room, session));
  syncHeader();
}

function refreshHostFlags(room: RoomRecord): void {
  for (const session of room.sessions.values()) {
    session.player.isHost = session.player.userId === room.info.hostId;
  }
}

function sendJoinError(frame: HTMLIFrameElement, message: string): void {
  log(`join failed: ${message}`, 'info');
  setRoomError(message);
  send(frame, { type: 'MULTIPLAYER_ERROR', code: 'ROOM_JOIN_FAILED', message });
}

function findJoinableRoom(): RoomRecord | null {
  for (const room of rooms.values()) {
    if (room.info.status === 'lobby' && room.sessions.size < room.info.maxPlayers) return room;
  }
  return null;
}

function attachToRoom(room: RoomRecord, frame: HTMLIFrameElement): ClientSession {
  counter += 1;
  const userId = `local-p${counter}`;
  const name =
    new URL(frame.src, window.location.href).searchParams.get('name') ?? `Player${counter}`;
  const player: MockPlayer = {
    userId,
    username: name,
    displayName: name,
    avatarKey: null,
    isReady: false,
    isHost: false,
  };
  if (!room.info.hostId) room.info.hostId = userId;
  player.isHost = userId === room.info.hostId;

  const session: ClientSession = { frame, player, roomId: room.info.roomId };
  room.sessions.set(frame, session);
  sessions.set(frame, session);
  activeRoomId = room.info.roomId;

  log(`join ${name} (${userId}) → ${room.info.roomId}`, 'host');
  refreshHostFlags(room);
  broadcastRoomState(room);
  for (const other of room.sessions.values()) {
    if (other === session) continue;
    send(other.frame, { type: 'MULTIPLAYER_PLAYER_JOINED', player });
  }
  return session;
}

/**
 * Join a frame to a room.
 *
 * `null` means "create or find an open lobby room"; a string means "join this
 * exact room". Returns `null` when an explicit room cannot be joined.
 */
function join(frame: HTMLIFrameElement, requestedRoomId: string | null): ClientSession | null {
  const existing = sessions.get(frame);

  if (requestedRoomId === null) {
    if (existing) {
      const current = rooms.get(existing.roomId);
      if (current) broadcastRoomState(current);
      return existing;
    }
    const room = findJoinableRoom() ?? createRoomRecord(nextAutoRoomId());
    return attachToRoom(room, frame);
  }

  const normalized = normalizeRoomId(requestedRoomId);
  if (normalized === null) {
    sendJoinError(frame, `ルームID「${requestedRoomId}」の形式が正しくありません`);
    return null;
  }

  const room = rooms.get(normalized);
  if (!room) {
    sendJoinError(frame, `ルーム ${normalized} が見つかりません`);
    return null;
  }
  if (existing?.roomId === normalized) {
    broadcastRoomState(room);
    return existing;
  }
  if (room.info.status !== 'lobby') {
    sendJoinError(frame, `ルーム ${normalized} は開始済みです`);
    return null;
  }
  if (room.sessions.size >= room.info.maxPlayers) {
    sendJoinError(frame, `ルーム ${normalized} は満員です`);
    return null;
  }
  if (existing) leave(frame);
  return attachToRoom(room, frame);
}

function leave(frame: HTMLIFrameElement): void {
  const session = sessions.get(frame);
  if (!session) return;
  sessions.delete(frame);

  const room = rooms.get(session.roomId);
  if (!room) return;
  room.sessions.delete(frame);
  log(`leave ${session.player.username} (${room.info.roomId})`, 'host');

  if (room.info.hostId === session.player.userId) {
    const remaining = room.sessions.values().next();
    room.info.hostId = remaining.done ? '' : remaining.value.player.userId;
  }
  refreshHostFlags(room);
  broadcastRoom(room, { type: 'MULTIPLAYER_PLAYER_LEFT', userId: session.player.userId });

  if (room.sessions.size === 0) {
    // Keep the room registered so its ID can be reused, but return it to a
    // fresh lobby instead of leaving a stale "playing" status behind.
    room.info.status = 'lobby';
    room.info.hostId = '';
  }
  broadcastRoomState(room);
}

function setReady(frame: HTMLIFrameElement, ready: boolean): void {
  const session = sessions.get(frame) ?? join(frame, null);
  if (!session) return;
  session.player.isReady = ready;
  const room = rooms.get(session.roomId);
  if (!room) return;
  log(`${session.player.username} ready=${ready}`, 'peer');
  broadcastRoom(room, {
    type: 'MULTIPLAYER_PLAYER_READY',
    userId: session.player.userId,
    ready,
  });
  broadcastRoomState(room);
}

function startGame(roomId: string = activeRoomId): void {
  const room = rooms.get(roomId);
  if (!room || room.sessions.size < 2) return;
  room.info.status = 'playing';
  log(`GAME_START ${room.info.roomId}`, 'host');
  broadcastRoom(room, { type: 'MULTIPLAYER_GAME_START' });
  broadcastRoomState(room);
}

function handleFrame(event: MessageEvent, frame: HTMLIFrameElement): void {
  if (event.origin !== window.location.origin) return;
  const data = event.data as { type?: unknown } & Record<string, unknown>;
  if (!data || typeof data.type !== 'string') return;
  const session = sessions.get(frame);

  switch (data.type) {
    case 'MULTIPLAYER_CONNECT': {
      const requestedRoomId = typeof data.roomId === 'string' ? data.roomId : null;
      join(frame, requestedRoomId);
      break;
    }
    case 'MULTIPLAYER_DISCONNECT':
      leave(frame);
      break;
    case 'MULTIPLAYER_SET_READY':
      setReady(frame, Boolean(data.ready));
      break;
    case 'MULTIPLAYER_START_GAME': {
      if (!session) return;
      const room = rooms.get(session.roomId);
      if (!room) return;
      if (session.player.userId !== room.info.hostId) {
        send(frame, {
          type: 'MULTIPLAYER_ERROR',
          code: 'NOT_HOST',
          message: 'ホストではありません',
        });
        return;
      }
      if (room.sessions.size < 2) {
        send(frame, {
          type: 'MULTIPLAYER_ERROR',
          code: 'NOT_ENOUGH_PLAYERS',
          message: '2人必要です',
        });
        return;
      }
      startGame(room.info.roomId);
      break;
    }
    case 'MULTIPLAYER_SEND_PEER_DATA': {
      if (!session) return;
      const room = rooms.get(session.roomId);
      if (!room) return;
      log(`peer data ${String(JSON.stringify(data.data)).slice(0, 140)}`, 'peer');
      broadcastRoom(room, { type: 'MULTIPLAYER_PEER_DATA', data: data.data }, frame);
      break;
    }
    case 'MULTIPLAYER_CHAT': {
      if (!session) return;
      const room = rooms.get(session.roomId);
      if (!room) return;
      log(`${session.player.username}: ${String(data.message)}`, 'peer');
      broadcastRoom(room, {
        type: 'MULTIPLAYER_CHAT',
        userId: session.player.userId,
        username: session.player.username,
        message: data.message,
      });
      break;
    }
    case 'MULTIPLAYER_REQUEST_STATE': {
      if (!session) return;
      const room = rooms.get(session.roomId);
      if (room) send(frame, roomStateFor(room, session));
      break;
    }
    case 'REQUEST_IDENTITY':
      if (!session) return;
      send(frame, {
        type: 'PLAYER_IDENTITY',
        identity: {
          userId: session.player.userId,
          username: session.player.username,
          displayName: session.player.displayName,
          avatarKey: null,
          equippedTitle: null,
        },
      });
      break;
    case 'REQUEST_FULLSCREEN':
      send(frame, { type: 'FULLSCREEN_GRANTED' });
      break;
    case 'REQUEST_FRESH':
      send(frame, { type: 'FRESH_GRANTED' });
      break;
    case 'POST_SCORE':
      log(`score ${String(data.score)} ${String(data.label ?? '')}`, 'peer');
      send(frame, { type: 'SCORE_SUBMITTED', score: data.score, label: data.label ?? '' });
      break;
    default:
      break;
  }
}

const autoConnectTimers = new Map<HTMLIFrameElement, number>();

/**
 * The game now opens on a room-entry screen. The harness is a mock parent and
 * historically auto-connected both frames, so drive the "create room" button
 * for frames that were not given an explicit `?room=` query.
 */
function autoConnectFrame(frame: HTMLIFrameElement, slot: 'a' | 'b'): void {
  const previous = autoConnectTimers.get(frame);
  if (previous !== undefined) window.clearInterval(previous);

  const url = new URL(frame.src, window.location.href);
  if (url.searchParams.has('room')) return;

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (attempts > 150) {
      window.clearInterval(timer);
      autoConnectTimers.delete(frame);
      return;
    }
    const button = frame.contentDocument?.querySelector<HTMLButtonElement>('#btn-create-room');
    if (!button || button.disabled) return;
    window.clearInterval(timer);
    autoConnectTimers.delete(frame);
    button.click();
    log(`frame ${slot} auto-create`, 'info');
  }, 100);
  autoConnectTimers.set(frame, timer);
}

function attach(frame: HTMLIFrameElement, slot: 'a' | 'b'): void {
  const handler = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return;
    handleFrame(event, frame);
  };
  window.addEventListener('message', handler);
  frame.addEventListener('load', () => {
    // The iframe creates a fresh document; drop any stale participant.
    if (sessions.has(frame)) leave(frame);
    log(`frame ${slot} loaded`, 'info');
    autoConnectFrame(frame, slot);
  });
}

attach(iframes.a, 'a');
attach(iframes.b, 'b');

// ------------------------------------------------------------------- controls

document.querySelector('#force-ready')?.addEventListener('click', () => {
  for (const room of rooms.values()) {
    for (const session of room.sessions.values()) {
      session.player.isReady = true;
      broadcastRoom(room, {
        type: 'MULTIPLAYER_PLAYER_READY',
        userId: session.player.userId,
        ready: true,
      });
    }
    broadcastRoomState(room);
  }
});

document.querySelector('#force-start')?.addEventListener('click', () => {
  for (const room of rooms.values()) {
    for (const session of room.sessions.values()) session.player.isReady = true;
    if (room.sessions.size >= 2) startGame(room.info.roomId);
    else broadcastRoomState(room);
  }
});

document.querySelector('#reload')?.addEventListener('click', () => {
  window.location.reload();
});

function reloadFrameIntoRoom(frame: HTMLIFrameElement, roomId: string): void {
  const url = new URL(frame.src, window.location.href);
  url.searchParams.set('room', roomId);
  frame.src = url.toString();
}

function joinRoomFromInput(): void {
  if (!roomInput) return;
  const normalized = normalizeRoomId(roomInput.value);
  if (normalized === null) {
    setRoomError('ルームIDは4〜16文字の英数字・ハイフン・アンダースコアで入力してください');
    return;
  }
  roomInput.value = normalized;

  const room = rooms.get(normalized);
  if (!room) {
    setRoomError(`ルーム ${normalized} が見つかりません`);
    return;
  }
  if (room.info.status !== 'lobby') {
    setRoomError(`ルーム ${normalized} は開始済みです`);
    return;
  }
  if (room.sessions.size >= room.info.maxPlayers) {
    setRoomError(`ルーム ${normalized} は満員です`);
    return;
  }
  setRoomError(null);
  reloadFrameIntoRoom(iframes.b, normalized);
}

/** Create a fresh room and move PLAYER A into it (harness convenience). */
function createRoomFor(slot: 'a' | 'b'): string {
  const frame = iframes[slot];
  if (sessions.has(frame)) leave(frame);
  const room = createRoomRecord(nextAutoRoomId());
  attachToRoom(room, frame);
  return room.info.roomId;
}

roomJoinButton?.addEventListener('click', () => joinRoomFromInput());

roomCreateButton?.addEventListener('click', () => {
  const roomId = createRoomFor('a');
  if (roomInput) roomInput.value = roomId;
  setRoomError(null);
});

roomInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  joinRoomFromInput();
});

// Make the harness inspectable from Playwright.
const harnessApi: HarnessApi = {
  get room() {
    return defaultRoom().info;
  },
  get players() {
    return playersIn(defaultRoom());
  },
  get rooms() {
    return [...rooms.values()].map((room) => ({ room: room.info, players: playersIn(room) }));
  },
  get activeRoomId() {
    return activeRoomId;
  },
  startGame: (roomId?: string) => startGame(roomId),
  setReady: (slot: 'a' | 'b', ready: boolean) => {
    setReady(iframes[slot], ready);
  },
  frame: (slot: 'a' | 'b') => iframes[slot],
  createRoom: (slot: 'a' | 'b' = 'a') => createRoomFor(slot),
  roomOf: (slot: 'a' | 'b') => sessions.get(iframes[slot])?.roomId ?? null,
};

(window as unknown as { __harness: HarnessApi }).__harness = harnessApi;
