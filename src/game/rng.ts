/**
 * Deterministic, dependency-free hashing and RNG helpers.
 *
 * Commitments are salted with 128 bits of randomness. The hash itself does not
 * need to be cryptographic for the 12 possible chairs as long as the salt stays
 * secret until both players reveal: without the salt, an attacker cannot test
 * the 12 candidates. cyrb53 is fast, stable and good enough for this purpose.
 */

/** cyrb53: 53-bit string hash with a second independent 32-bit mix. */
export function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Stable 16-hex-character commitment for (chair, salt). */
export function commitmentHash(chair: number, salt: string): string {
  const value = cyrb53(`denki-isu:v1:${chair}:${salt}`, 0x9e3779b9);
  return value.toString(16).padStart(16, '0');
}

export function verifyCommitment(hash: string, chair: number, salt: string): boolean {
  return commitmentHash(chair, salt) === hash.toLowerCase();
}

const HEX = '0123456789abcdef';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** 128-bit hex salt (32 characters). */
export function createSalt(): string {
  return Array.from(randomBytes(16), (byte) => HEX[byte >>> 4]! + HEX[byte & 15]!).join('');
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function createRng(seed: string | number): () => number {
  let state = typeof seed === 'number' ? seed >>> 0 : cyrb53(seed, 0x85ebca6b) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic random integer in [min, max]. */
export function randomInt(seed: string | number, min: number, max: number): number {
  const rng = createRng(seed);
  return min + Math.floor(rng() * (max - min + 1));
}

export function randomId(prefix = 'm'): string {
  const bytes = randomBytes(8);
  const packed = Array.from(bytes, (byte) => HEX[byte >>> 4]! + HEX[byte & 15]!).join('');
  return `${prefix}_${packed}`;
}
