# IP-0 TRACER BULLET REPORT
## VA-5 + RC-5 substrate measurements · CTO

> Pre-registered criteria (IP-0_DESIGN §32): **M1** append→ack p99 ≤ 20ms engine-internal over 10k sequential commands · **M2** replay 10k events < 10s · **M3** 200 concurrent WS subscribers receive a published event p95 < 500ms · **M4** client→ack RTT, observational. Spike code: `spikes/tracer-bullet/` (throwaway; deleted at IP-0 exit — this report survives).

## Run 1 — LOCAL BASELINE · 2026-07-12

Environment: MacBook (Apple Silicon), Node 25.6.1/tsx, Postgres 17-alpine in Docker on the same machine, loopback network. **This run does NOT satisfy the gate** — it establishes the software's own overhead floor so the gated run can attribute latency to the network/substrate, not the code.

| Measure | n | p50 | p95 | p99 | max | Target | Verdict |
|---|---|---|---|---|---|---|---|
| M1 append→ack (engine-internal) | 10,000 | 0.22ms | 0.48ms | 0.92ms | 4.76ms | p99 ≤ 20ms | **PASS (baseline)** |
| M2 replay 10k events | 1 | — | — | — | 8ms | < 10s | **PASS (baseline)** |
| M3 fan-out, 200 subs × 20 events | 4,000/4,000 delivered | 2.00ms | 4.00ms | 4.00ms | 5.00ms | p95 < 500ms | **PASS (baseline)** |
| M4 client→ack RTT (observational) | 10,000 | 0.31ms | 0.72ms | 1.29ms | 29.78ms | report only | recorded |

Reading: the spike's own cost is ~1ms at p99 — the 20ms M1 budget is therefore almost entirely available for the Fly↔Neon round trip. Zero dropped fan-out deliveries at 200 subscribers on one process.

## Run 2 — GATED RUN (Fly `bom` + Neon Mumbai) · PENDING

Blocked on founder externals (§32): Fly + Neon accounts. Procedure: deploy the spike to a shared-cpu Fly machine in `bom` against the Neon dev branch; run `measure` from a Mumbai-region client with `TARGET_URL` set. **The IP-0 exit gate is this run, not Run 1.** If Neon has no Mumbai region or M1/M2/M3 fail, the substrate decision reopens with alternates measured (Neon Singapore, RDS/Supabase Mumbai) per §34 — no silent continue.

| Measure | Result | Verdict |
|---|---|---|
| M1 | — | pending |
| M2 | — | pending |
| M3 | — | pending |
| M4 | — | pending |
