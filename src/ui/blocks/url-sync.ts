/** Keep rendering immediate while bounding writes to the browser's History API. */
export const URL_WRITE_INTERVAL_MS = 400;
const RETRY_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 3;

export type UrlSyncStatus = "synced" | "pending" | "error";

export interface UrlSyncPort {
  readonly read: () => string;
  readonly write: (url: string) => void;
  readonly now: () => number;
  readonly schedule: (callback: () => void, delay: number) => number;
  readonly clear: (id: number) => void;
  readonly status: (state: UrlSyncStatus) => void;
}

/** Latest request wins. Cancel queued requests before loading browser history. */
export function createUrlSync(port: UrlSyncPort) {
  let pending: string | null = null;
  let timer: number | null = null;
  let nextWrite = Number.NEGATIVE_INFINITY;
  let attempts = 0;
  let closed = false;

  function clearTimer(): void {
    if (timer !== null) {
      port.clear(timer);
      timer = null;
    }
  }

  function flush(): void {
    timer = null;
    if (closed || pending === null) return;
    const target = pending;
    if (port.read() === target) {
      pending = null;
      port.status("synced");
      return;
    }
    const delay = nextWrite - port.now();
    if (delay > 0) {
      timer = port.schedule(flush, delay);
      return;
    }
    nextWrite = port.now() + URL_WRITE_INTERVAL_MS;
    attempts += 1;
    try {
      port.write(target);
    } catch {
      // A rejected write must not stop the independent model/render update.
      // The readback below also detects browsers that silently ignore a write.
    }
    if (port.read() === target) {
      pending = null;
      port.status("synced");
    } else {
      port.status("error");
      nextWrite = port.now() + RETRY_INTERVAL_MS;
      if (attempts < MAX_ATTEMPTS) timer = port.schedule(flush, RETRY_INTERVAL_MS);
    }
  }

  return {
    request(url: string): void {
      if (closed) return;
      clearTimer();
      pending = url;
      attempts = 0;
      port.status("pending");
      flush();
    },
    cancel(): void {
      clearTimer();
      pending = null;
      port.status("synced");
    },
    dispose(): void {
      clearTimer();
      pending = null;
      closed = true;
    },
  };
}
