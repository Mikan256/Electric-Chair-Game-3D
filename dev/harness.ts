/**
 * A mock Flaxia parent for local development.
 *
 * It speaks the documented postMessage protocol so the real game client and
 * MatchSession run unchanged. Two iframes share a room and relay peer data,
 * which exercises the commit-reveal flow with genuinely separate documents.
 */
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
}

const roomId = 'LOCAL';
const gameId = 'denki-isu-3d';
const iframes: Record<'a' | 'b', HTMLIFrameElement> = {
  a: document.querySelector<HTMLIFrameElement>('#frame-a')!,
  b: document.querySelector<HTMLIFrameElement>('#frame-b')!,
};
const statusEl = document.querySelector<HTMLElement>('#status')!;
const playersEl = document.querySelector<HTMLElement>('#players')!;
const logEl = document.querySelector<HTMLElement>('#log')!;

let room: RoomInfo = {
  roomId,
  gameId,
  hostId: '',
  status: 'lobby',
  maxPlayers: 2,
  isPublic: true,
  createdAt: Date.now(),
};
const sessions = new Map<HTMLIFrameElement, ClientSession>();
let counter = 0;

function log(message: string, kind: 'host' | 'peer' | 'info' = 'info'): void {
  const line = document.createElement('div');
  line.className = kind;
  line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 80) logEl.firstElementChild?.remove();
}

function send(frame: HTMLIFrameElement, framePayload: Record<string, unknown>): void {
  frame.contentWindow?.postMessage(framePayload, window.location.origin);
}

function broadcast(payload: Record<string, unknown>, except?: HTMLIFrameElement): void {
  for (const frame of Object.values(iframes)) {
    if (frame !== except && frame.contentWindow) send(frame, payload);
  }
}

function players(): MockPlayer[] {
  return [...sessions.values()].map((session) => session.player);
}

function roomStateFor(session: ClientSession): Record<string, unknown> {
  return {
    type: 'MULTIPLAYER_ROOM_STATE',
    room,
    players: players(),
    selfId: session.player.userId,
  };
}

function broadcastRoomState(): void {
  for (const session of sessions.values()) send(session.frame, roomStateFor(session));
  statusEl.textContent = room.status;
  playersEl.textContent = `${sessions.size} / 2`;
}

function refreshHostFlags(): void {
  const list = players();
  for (const session of sessions.values()) {
    session.player.isHost = session.player.userId === room.hostId;
  }
  void list;
}

function join(frame: HTMLIFrameElement): ClientSession {
  const existing = sessions.get(frame);
  if (existing) return existing;
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
  if (!room.hostId) room.hostId = userId;
  player.isHost = userId === room.hostId;
  const session: ClientSession = { frame, player };
  sessions.set(frame, session);
  log(`join ${name} (${userId})`, 'host');
  refreshHostFlags();
  broadcastRoomState();
  for (const other of sessions.values()) {
    if (other === session) continue;
    send(other.frame, { type: 'MULTIPLAYER_PLAYER_JOINED', player });
  }
  return session;
}

function leave(frame: HTMLIFrameElement): void {
  const session = sessions.get(frame);
  if (!session) return;
  sessions.delete(frame);
  log(`leave ${session.player.username}`, 'host');
  if (room.hostId === session.player.userId) {
    room.hostId = players()[0]?.userId ?? '';
    refreshHostFlags();
  }
  broadcast({ type: 'MULTIPLAYER_PLAYER_LEFT', userId: session.player.userId });
  broadcastRoomState();
}

function setReady(frame: HTMLIFrameElement, ready: boolean): void {
  const session = join(frame);
  session.player.isReady = ready;
  log(`${session.player.username} ready=${ready}`, 'peer');
  broadcast({ type: 'MULTIPLAYER_PLAYER_READY', userId: session.player.userId, ready });
  broadcastRoomState();
}

function startGame(): void {
  if (sessions.size < 2) return;
  room = { ...room, status: 'playing' };
  log('GAME_START', 'host');
  broadcast({ type: 'MULTIPLAYER_GAME_START' });
  broadcastRoomState();
}

function handleFrame(event: MessageEvent, frame: HTMLIFrameElement): void {
  if (event.origin !== window.location.origin) return;
  const data = event.data as { type?: string } & Record<string, unknown>;
  if (!data || typeof data.type !== 'string') return;
  const session = sessions.get(frame);

  switch (data.type) {
    case 'MULTIPLAYER_CONNECT':
      join(frame);
      break;
    case 'MULTIPLAYER_DISCONNECT':
      leave(frame);
      break;
    case 'MULTIPLAYER_SET_READY':
      setReady(frame, Boolean(data.ready));
      break;
    case 'MULTIPLAYER_START_GAME': {
      if (!session || session.player.userId !== room.hostId) {
        if (session) {
          send(frame, {
            type: 'MULTIPLAYER_ERROR',
            code: 'NOT_HOST',
            message: 'ホストではありません',
          });
        }
        return;
      }
      if (sessions.size < 2) {
        send(frame, {
          type: 'MULTIPLAYER_ERROR',
          code: 'NOT_ENOUGH_PLAYERS',
          message: '2人必要です',
        });
        return;
      }
      startGame();
      break;
    }
    case 'MULTIPLAYER_SEND_PEER_DATA':
      log(`peer data ${String(JSON.stringify(data.data)).slice(0, 140)}`, 'peer');
      broadcast({ type: 'MULTIPLAYER_PEER_DATA', data: data.data }, frame);
      break;
    case 'MULTIPLAYER_CHAT':
      if (!session) return;
      log(`${session.player.username}: ${String(data.message)}`, 'peer');
      broadcast({
        type: 'MULTIPLAYER_CHAT',
        userId: session.player.userId,
        username: session.player.username,
        message: data.message,
      });
      break;
    case 'MULTIPLAYER_REQUEST_STATE':
      if (session) send(frame, roomStateFor(session));
      break;
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
  });
}

attach(iframes.a, 'a');
attach(iframes.b, 'b');

document.querySelector('#force-ready')?.addEventListener('click', () => {
  for (const [frame, session] of sessions) {
    session.player.isReady = true;
    broadcast({ type: 'MULTIPLAYER_PLAYER_READY', userId: session.player.userId, ready: true });
    void frame;
  }
  broadcastRoomState();
});

document.querySelector('#force-start')?.addEventListener('click', () => {
  for (const session of sessions.values()) session.player.isReady = true;
  broadcastRoomState();
  startGame();
});

document.querySelector('#reload')?.addEventListener('click', () => {
  window.location.reload();
});

// Make the harness inspectable from Playwright.
(window as unknown as { __harness?: unknown }).__harness = {
  get room() {
    return room;
  },
  get players() {
    return players();
  },
  startGame,
  setReady: (slot: 'a' | 'b', ready: boolean) => {
    const frame = iframes[slot];
    setReady(frame, ready);
  },
  frame: (slot: 'a' | 'b') => iframes[slot],
};
