/**
 * Client-side rate limiter for the Cin7 Omni API.
 *
 * Cin7 enforces 3 calls/second, 60 calls/minute and 5,000 calls/day.
 * We queue outgoing requests and only release them when both the
 * per-second and per-minute windows have room, so well-behaved sessions
 * never see a 429 in the first place.
 */

interface Window {
  limit: number;
  intervalMs: number;
  timestamps: number[];
}

export class RateLimiter {
  private windows: Window[];
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    perSecond = 3,
    perMinute = 60,
  ) {
    this.windows = [
      { limit: perSecond, intervalMs: 1_000, timestamps: [] },
      { limit: perMinute, intervalMs: 60_000, timestamps: [] },
    ];
  }

  /** Resolves when the caller is allowed to fire one request. */
  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private drain(): void {
    const now = Date.now();
    for (const w of this.windows) {
      w.timestamps = w.timestamps.filter((t) => now - t < w.intervalMs);
    }
    while (this.queue.length > 0 && this.windows.every((w) => w.timestamps.length < w.limit)) {
      const resolve = this.queue.shift()!;
      for (const w of this.windows) w.timestamps.push(now);
      resolve();
    }
    if (this.queue.length > 0 && this.timer === null) {
      // Wake up when the earliest timestamp falls out of its window.
      const waits = this.windows
        .filter((w) => w.timestamps.length >= w.limit)
        .map((w) => w.timestamps[0] + w.intervalMs - now);
      const delay = Math.max(10, Math.min(...waits));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, delay);
      // Don't keep the process alive just for queued rate-limit slots.
      this.timer.unref?.();
    }
  }
}
