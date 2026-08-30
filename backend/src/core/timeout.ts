/**
 * Bounds a promise that has no timeout of its own.
 *
 * Used by the readiness probe: a driver retrying a dead TCP connection can take
 * tens of seconds to reject, and a probe that hangs looks like a crashed process
 * to an orchestrator rather than an unready one.
 */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  // clearTimeout matters: without it the pending timer keeps the event loop
  // alive and delays shutdown by up to `ms`.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
