import type { MatchView } from '@/game/types';

export const NET_PROTOCOL_VERSION = 1;

export type ClientAction =
  | { readonly type: 'commit'; readonly hash: string }
  | { readonly type: 'reveal'; readonly chair: number; readonly salt: string }
  | { readonly type: 'advance' }
  | { readonly type: 'forfeit' };

export type WireMessage =
  | { readonly t: 'hello'; readonly from: string; readonly name: string; readonly v: number }
  | {
      readonly t: 'view';
      readonly from: string;
      readonly to?: string;
      readonly seq: number;
      readonly view: MatchView;
    }
  | {
      readonly t: 'action';
      readonly from: string;
      readonly action: ClientAction;
      readonly turn: number;
      readonly phase: string;
    }
  | { readonly t: 'sync'; readonly from: string }
  | { readonly t: 'rematch'; readonly from: string; readonly ready: boolean }
  | { readonly t: 'error'; readonly from: string; readonly code: string; readonly message: string }
  | { readonly t: 'chat'; readonly from: string; readonly name: string; readonly text: string };

export function isWireMessage(value: unknown): value is WireMessage {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { t?: unknown }).t;
  return (
    t === 'hello' ||
    t === 'view' ||
    t === 'action' ||
    t === 'sync' ||
    t === 'rematch' ||
    t === 'error' ||
    t === 'chat'
  );
}

/** 65,536 bytes is the platform limit for sendPeerData. */
export const MAX_PEER_PAYLOAD_BYTES = 65_536;
