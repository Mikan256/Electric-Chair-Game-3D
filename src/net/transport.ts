/**
 * Transport abstraction shared by the real Flaxia bridge and the local
 * in-memory / dev-harness bridges.
 */
export interface Transport {
  readonly selfId: string;
  readonly hostId: string;
  send(message: unknown): void;
  subscribe(listener: (message: unknown, from: string) => void): () => void;
  close(): void;
}
