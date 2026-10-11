/** One visible-page viewer ping per minute, independent of the score tab. */
export class ViewPing {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | undefined;
  private stopped = false;
  private visible = false;
  private lastAt: number | null = null;
  constructor(
    private url: string,
    private proof: { t?: string; s?: string },
    private fetcher: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}
  start(visible: boolean) {
    this.visibility(visible);
  }
  visibility(visible: boolean) {
    this.visible = visible;
    clearTimeout(this.timer);
    this.schedule();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.request?.abort();
  }
  private schedule() {
    if (this.stopped || !this.visible || this.request) return;
    const delay = this.lastAt === null ? 0 : Math.max(0, 60000 - (this.now() - this.lastAt));
    this.timer = setTimeout(() => {
      void this.ping();
    }, delay);
  }
  private async ping() {
    if (this.stopped || !this.visible || this.request) return;
    this.lastAt = this.now();
    const request = new AbortController();
    this.request = request;
    try {
      const fetcher = this.fetcher;
      await fetcher(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.proof),
        signal: request.signal,
      });
    } catch {
      // Viewer counts must never interrupt the score or retry above the limit.
    } finally {
      this.request = undefined;
      this.schedule();
    }
  }
}
