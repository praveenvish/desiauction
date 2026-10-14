/** Types for the load script, so typed tests can drive it (F05). */
export function percentile(values: readonly number[], fraction: number): number | null;
export function liveLoad(
  target: string,
  options?: {
    viewers?: number;
    durationSeconds?: number;
    intervalMs?: number;
    staggerMs?: number;
    timeoutMs?: number;
  },
): Promise<Record<string, unknown> & { passed: boolean; p95Ms: number | null }>;
export function socketLoad(
  target: string,
  options: {
    fixtures: readonly string[];
    perRoom?: number;
    gate?: { s?: string; t?: string };
    origin: string;
    durationSeconds?: number;
    staggerMs?: number;
    timeoutMs?: number;
    distinctClients?: boolean;
  },
): Promise<{
  rooms: number;
  perRoom: number;
  sockets: number;
  opened: number;
  framed: number;
  frames: number;
  failures: number;
  earlyCloses: Record<string, number>;
  p50Ms: number | null;
  p95Ms: number | null;
  passed: boolean;
}>;
