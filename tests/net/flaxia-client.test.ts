import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlaxiaClient, normalizeRoomId } from '@/net/flaxia-client';
import type { MultiplayerError, PlayerInfo, RoomInfo, RoomState } from '@/net/flaxia-client';

interface PostedFrame {
  data: Record<string, unknown>;
  targetOrigin: string;
}

type MessageListener = (event: MessageEvent) => void;

interface ParentMock {
  postMessage: (data: unknown, targetOrigin: string) => void;
}

interface WindowMock {
  parent: ParentMock;
  location: { hostname: string; origin: string };
  addEventListener: (type: string, listener: MessageListener) => void;
  removeEventListener: (type: string, listener: MessageListener) => void;
}

interface DomHarness {
  posted: PostedFrame[];
  parent: ParentMock;
  dispatch: (data: Record<string, unknown>, origin?: string) => void;
}

const ORIGIN = 'http://127.0.0.1:5173';

function installDom(): DomHarness {
  const posted: PostedFrame[] = [];
  const listeners = new Set<MessageListener>();
  const parent: ParentMock = {
    postMessage(data: unknown, targetOrigin: string) {
      posted.push({ data: data as Record<string, unknown>, targetOrigin });
    },
  };
  const windowMock: WindowMock = {
    parent,
    location: { hostname: '127.0.0.1', origin: ORIGIN },
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
  };

  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('document', { referrer: '' });

  return {
    posted,
    parent,
    dispatch(data, origin = ORIGIN) {
      for (const listener of [...listeners]) {
        listener({ source: parent, origin, data } as unknown as MessageEvent);
      }
    },
  };
}

function roomInfo(roomId: string): RoomInfo {
  return {
    roomId,
    gameId: 'denki-isu-3d',
    hostId: 'host',
    status: 'lobby',
    maxPlayers: 2,
    isPublic: true,
    createdAt: 0,
  };
}

function player(userId: string, isHost = false): PlayerInfo {
  return {
    userId,
    username: userId,
    displayName: null,
    avatarKey: null,
    isReady: false,
    isHost,
  };
}

function roomState(roomId: string): RoomState {
  return { room: roomInfo(roomId), players: [player('host', true), player('guest')] };
}

describe('normalizeRoomId', () => {
  it.each([
    [' ab12 ', 'AB12'],
    ['abcd', 'ABCD'],
    ['A1-b_9', 'A1-B_9'],
    ['1234567890123456', '1234567890123456'],
    ['abc', null],
    ['12345678901234567', null],
    ['', null],
    ['   ', null],
    ['ab cd', null],
    ['ab.cd', null],
    ['あいうえ', null],
    ['ab/cd', null],
    ['abc!', null],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeRoomId(input)).toBe(expected);
  });
});

describe('FlaxiaClient room commands', () => {
  let dom: DomHarness;
  let client: FlaxiaClient | null;

  beforeEach(() => {
    dom = installDom();
    client = null;
  });

  afterEach(() => {
    client?.destroy();
    client = null;
    vi.unstubAllGlobals();
  });

  function makeClient(): FlaxiaClient {
    client = new FlaxiaClient({ gameId: 'denki-isu-3d', autoConnect: false });
    return client;
  }

  it('createRoom sends MULTIPLAYER_CONNECT without a roomId', () => {
    const c = makeClient();
    c.createRoom();

    expect(dom.posted).toHaveLength(1);
    expect(dom.posted[0]?.data).toEqual({
      type: 'MULTIPLAYER_CONNECT',
      gameId: 'denki-isu-3d',
    });
    expect(dom.posted[0]?.data.roomId).toBeUndefined();
    expect(dom.posted[0]?.targetOrigin).toBe(ORIGIN);
    expect(c.currentRoomId).toBeNull();
  });

  it('joinRoom trims and uppercases the roomId before sending', () => {
    const c = makeClient();
    c.joinRoom(' ab12 ');

    expect(dom.posted).toHaveLength(1);
    expect(dom.posted[0]?.data).toEqual({
      type: 'MULTIPLAYER_CONNECT',
      gameId: 'denki-isu-3d',
      roomId: 'AB12',
    });
    expect(c.currentRoomId).toBe('AB12');
    expect(c.requestedRoomId).toBe('AB12');
  });

  it('never sends an invalid roomId and emits INVALID_ROOM_ID', () => {
    const c = makeClient();
    const errors: MultiplayerError[] = [];
    c.on('onError', (error) => errors.push(error));

    c.joinRoom('ab');
    c.joinRoom('ab cd');
    c.joinRoom('');

    expect(dom.posted).toHaveLength(0);
    expect(errors).toHaveLength(3);
    expect(errors.every((error) => error.code === 'INVALID_ROOM_ID')).toBe(true);
  });

  it('clears previously received room state when switching rooms', () => {
    const c = makeClient();
    const states: RoomState[] = [];
    c.on('onRoomState', (state) => states.push(state));

    dom.dispatch({ type: 'MULTIPLAYER_ROOM_STATE', ...roomState('ROOM2') });
    expect(states).toHaveLength(1);
    expect(c.isConnected).toBe(true);
    expect(c.currentRoom?.roomId).toBe('ROOM2');
    expect(c.players).toHaveLength(2);

    c.joinRoom('ROOM3');
    expect(c.currentRoom).toBeNull();
    expect(c.players).toEqual([]);
    expect(c.isConnected).toBe(false);
    expect(c.currentRoomId).toBe('ROOM3');
  });

  it('createRoom clears a previously requested room', () => {
    const c = makeClient();
    c.joinRoom('ROOM2');
    dom.dispatch({ type: 'MULTIPLAYER_ROOM_STATE', ...roomState('ROOM2') });

    c.createRoom();

    expect(c.currentRoom).toBeNull();
    expect(c.currentRoomId).toBeNull();
    const last = dom.posted.at(-1);
    expect(last?.data.type).toBe('MULTIPLAYER_CONNECT');
    expect(last?.data.roomId).toBeUndefined();
  });

  it('clears the rejected roomId on ROOM_JOIN_FAILED so the UI can retry', () => {
    const c = makeClient();
    const errors: MultiplayerError[] = [];
    c.on('onError', (error) => errors.push(error));

    c.joinRoom('ROOM2');
    dom.dispatch({
      type: 'MULTIPLAYER_ERROR',
      code: 'ROOM_JOIN_FAILED',
      message: 'ルーム ROOM2 が見つかりません',
    });

    expect(errors).toEqual([
      { code: 'ROOM_JOIN_FAILED', message: 'ルーム ROOM2 が見つかりません' },
    ]);
    expect(c.currentRoomId).toBeNull();
    expect(c.requestedRoomId).toBeNull();
    expect(c.isConnected).toBe(false);

    // connect() must now create a room instead of retrying the rejected ID.
    c.connect();
    const last = dom.posted.at(-1);
    expect(last?.data.type).toBe('MULTIPLAYER_CONNECT');
    expect(last?.data.roomId).toBeUndefined();
  });

  it('keeps connect() backwards compatible', () => {
    const c = makeClient();
    c.connect();
    expect(dom.posted.at(-1)?.data.roomId).toBeUndefined();

    c.connect('ROOM3');
    expect(dom.posted.at(-1)?.data.roomId).toBe('ROOM3');
    expect(c.requestedRoomId).toBe('ROOM3');
  });

  it('ignores messages from an unknown origin', () => {
    const c = makeClient();
    c.connect('ROOM2');
    const states: RoomState[] = [];
    c.on('onRoomState', (state) => states.push(state));

    dom.dispatch({ type: 'MULTIPLAYER_ROOM_STATE', ...roomState('ROOM2') }, 'https://evil.example');

    expect(states).toHaveLength(0);
    expect(c.isConnected).toBe(false);
  });
});
