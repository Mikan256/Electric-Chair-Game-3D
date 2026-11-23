import type { Transport } from './transport';

interface PeerEntry {
  hostId: string;
  handlers: Set<(message: unknown, from: string) => void>;
  closed: boolean;
}

/**
 * In-process bus used by solo mode and unit tests.
 * Delivery is asynchronous (microtask) to mimic postMessage ordering.
 */
export class MemoryBus {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly queues: Array<() => void> = [];
  private flushing = false;

  addPeer(selfId: string, hostId: string): Transport {
    const entry: PeerEntry = { hostId, handlers: new Set(), closed: false };
    this.peers.set(selfId, entry);

    return {
      selfId,
      hostId,
      send: (message: unknown) => {
        if (entry.closed) return;
        for (const [otherId, other] of this.peers) {
          if (otherId === selfId || other.closed) continue;
          this.enqueue(() => {
            for (const handler of [...other.handlers]) handler(message, selfId);
          });
        }
      },
      subscribe: (listener) => {
        entry.handlers.add(listener);
        return () => entry.handlers.delete(listener);
      },
      close: () => {
        entry.closed = true;
        entry.handlers.clear();
        this.peers.delete(selfId);
      },
    };
  }

  get peerIds(): string[] {
    return [...this.peers.keys()];
  }

  private enqueue(task: () => void): void {
    this.queues.push(task);
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => {
      try {
        while (this.queues.length > 0) {
          this.queues.shift()!();
        }
      } finally {
        this.flushing = false;
      }
    });
  }
}
