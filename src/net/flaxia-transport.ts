import type { FlaxiaClient } from './flaxia-client';
import { MAX_PEER_PAYLOAD_BYTES } from './protocol';
import type { Transport } from './transport';

/**
 * Bridges MatchSession to the Flaxia parent relay (`sendPeerData` /
 * `onPeerData`). The frame has no sender field, so every wire message carries
 * its own `from` id and the session verifies it against the roster.
 */
export class FlaxiaTransport implements Transport {
  readonly selfId: string;
  readonly hostId: string;
  private readonly client: FlaxiaClient;
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(client: FlaxiaClient, selfId: string, hostId: string) {
    this.client = client;
    this.selfId = selfId;
    this.hostId = hostId;
    this.unsubscribe = client.on('onPeerData', (event) =>
      this.listener?.(event.data, extractFrom(event.data)),
    );
  }

  private listener: ((message: unknown, from: string) => void) | null = null;

  send(message: unknown): void {
    if (this.closed) return;
    const json = JSON.stringify(message);
    if (new TextEncoder().encode(json).length > MAX_PEER_PAYLOAD_BYTES) {
      throw new Error('P2P ペイロードが 65,536 bytes を超えています');
    }
    this.client.sendPeerData(message);
  }

  subscribe(listener: (message: unknown, from: string) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  close(): void {
    this.closed = true;
    this.listener = null;
    this.unsubscribe();
  }
}

function extractFrom(data: unknown): string {
  if (data && typeof data === 'object' && typeof (data as { from?: unknown }).from === 'string') {
    return (data as { from: string }).from;
  }
  return '';
}
