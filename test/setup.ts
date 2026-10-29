import { webcrypto } from 'node:crypto';

// jsdom has no crypto.subtle; Node's webcrypto does.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
