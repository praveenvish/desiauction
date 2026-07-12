# tracer-bullet (THROWAWAY)

The IP-0 substrate proof (IP-0_DESIGN §32). Deleted at IP-0 exit; only `docs/phase-2/IP-0_TRACER_REPORT.md` survives.

Pre-registered pass/fail (VA-5 + RC-5): **M1** append→ack p99 ≤ 20ms engine-internal over 10k sequential commands · **M2** replay 10k events < 10s · **M3** 200 concurrent WS subscribers receive a published event p95 < 500ms · **M4** client→ack RTT, observational.

Run (needs `spike_ledger` migrated — `pnpm --filter @desiauction/engine db:migrate`):

```sh
DATABASE_URL=... pnpm --filter @desiauction/spike-tracer-bullet serve     # terminal 1
DATABASE_URL=... pnpm --filter @desiauction/spike-tracer-bullet measure  # terminal 2
```

For the gated run, `serve` runs on Fly `bom` against Neon Mumbai and `measure` runs from a Mumbai-region client with `TARGET_URL` set. Numbers are reported as measured, pass or fail — a failed gate reopens the substrate decision (§34), never silently continues.
