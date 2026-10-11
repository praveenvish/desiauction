import type { PublicAccessProof, PublicViewerIdentity } from "./public";
interface Bucket {
  identity: PublicViewerIdentity;
  minute: number;
  count: number;
  proofs: PublicAccessProof[];
  failures: number;
}
/** Per-process minute counts, with bounded memory/retries and no overlapping flush. */
export class ViewerBuckets {
  private buckets = new Map<string, Bucket>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;
  constructor(
    private persist: (
      identity: PublicViewerIdentity,
      proofs: readonly PublicAccessProof[],
      count: number,
    ) => Promise<boolean>,
    private schedule = true,
  ) {}
  record(identity: PublicViewerIdentity, proof: PublicAccessProof, now: number) {
    const minute = Math.floor(now / 60000);
    const key = `${identity.fixtureId}:${String(minute)}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= 2048) {
        const oldest = this.buckets.keys().next().value;
        if (oldest) this.buckets.delete(oldest);
      }
      bucket = { identity, minute, count: 0, proofs: [], failures: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count = Math.min(2147483647, bucket.count + 1);
    if (!bucket.proofs.some((item) => item.t === proof.t && item.s === proof.s)) {
      if (bucket.proofs.length >= 8) bucket.proofs.shift();
      bucket.proofs.push({ ...proof });
    }
    if (this.schedule && !this.timer) {
      this.timer = setInterval(() => {
        void this.flush(Date.now());
      }, 60000);
      this.timer.unref();
    }
  }
  async flush(now: number) {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const current = Math.floor(now / 60000);
      for (const [key, bucket] of this.buckets) {
        if (bucket.minute >= current) continue;
        if (current - bucket.minute > 5 || bucket.failures >= 3) {
          this.buckets.delete(key);
          continue;
        }
        const count = bucket.count;
        try {
          const allowed = await this.persist(bucket.identity, [...bucket.proofs], count);
          if (!allowed || bucket.count === count) this.buckets.delete(key);
          else bucket.failures = 0;
        } catch {
          bucket.failures += 1;
          if (bucket.failures >= 3) this.buckets.delete(key);
        }
      }
    } finally {
      this.flushing = false;
      if (this.buckets.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    }
  }
}
