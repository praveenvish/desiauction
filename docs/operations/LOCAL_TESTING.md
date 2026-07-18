# Local Testing — the Complete Journey

Everything below runs against `pnpm dev` with the seeded demo data. No manual
SQL, no mocks — every step exercises the real workflow through the real UI.
The dev adapters stand in for external accounts only: OTP codes land in
`/dev/inbox`, payments use the built-in manual gateway (cash/UPI attest),
receipt dispatch uses the in-app channel + outbox, and export artifacts are
written to `.local/finops-artifacts/`.

## The journey (30–40 minutes, one sitting)

1. **Login** — `/login`, phone `9999000001` (Founder); code at `/dev/inbox`.
2. **Create organization** — `/orgs` → create (or use the seeded
   `/org/demo-club`).
3. **Invite user** — org page → create invite (org:staff) → copy the
   `/join/…` link.
4. **Accept invite** — open the link in a private window, sign in as
   `9999000007` (Viewer), accept — they appear on the member list.
5. **Create competition** — `/competitions` → create in your org (or use the
   seeded Demo Premier League, which already has teams + players).
6. **Approve registrations** — competition → registrations dashboard: two
   seeded players are `submitted`; approve them (single or bulk). Assign
   teams if unassigned.
7. **Generate fixtures** — fixtures dashboard → add a venue + ground
   (`/org/demo-club/venues`) → generate; inspect the conflict engine by
   rescheduling two fixtures onto the same ground/time.
8. **Create auction** — advance the competition to `registration_closed`,
   open the auction dashboard, create the auction (checklist must be green).
9. **Claim paddle** — invite owners: auction cockpit → owner invite per team
   → open each `/owner-join/…` link as Bidder A/B/C (`9999000004/5/6`) →
   accept → grant paddle → each bidder claims.
10. **Run the live auction** — conductor opens the cockpit, queues lots,
    opens the auction and the first lot; bidders bid from `/live`.
11. **Anti-snipe** — bid with under 15 s left: the timer extends.
12. **Pause / Resume** — cockpit lifecycle controls mid-lot.
13. **Restart engine + recovery** — kill the engine process (Ctrl-C the
    `@desiauction/engine` pane or `kill $(lsof -tnP -iTCP:4000)`); watch
    every browser show the outage; restart with `pnpm dev` (or
    `pnpm --filter @desiauction/engine dev`) — the engine replays the event
    log, re-arms timers, and every window reconverges on the identical
    snapshot. Run "verify replay" from the cockpit for the divergence report.
14. **Complete auction** — sell/requeue every lot, then complete. Visit the
    ledger and replay viewer (cockpit) for the audit surfaces.
15. **Settlement** — open the settlement case from the completed auction,
    verify, compute obligations; record manual payments (cash/UPI) and
    attest capture — the journal posts collections and discharges.
16. **Issue receipt** — financial operations: open a receipt series (or use
    the seeded RCT series in demo-club), issue receipts for the captured
    payments; reproduce a document (byte-identical digest check).
17. **Dispatch receipt** — request dispatch (in-app channel); the runner
    picks the job up within its 15 s tick — or watch `finops_jobs` drain.
18. **Generate export** — request a journal-csv export; the artifact lands
    in `.local/finops-artifacts/` with its digest recorded.
19. **Fiscal close** — open the ended fiscal period, attest the day
    checklist, close: the period seals with reproducible evidence (the
    seeded demo-club already contains a SEALED period to compare against).
20. **Replay + certification** — `pnpm --filter @desiauction/engine test:integration`
    runs the certification suite (deterministic replay, gap detection,
    recovery drills) against your live local database.

## Production-posture mode (RLS load-bearing)

By default local dev connects as the table owner (RLS bypassed — the app
layer scopes every query). To run **exactly like production**, flip
`.env.local` to the app role (the commented block `setup:local` generated):

```
DATABASE_URL=postgres://desiauction_app:local-app@localhost:5433/desiauction
SYSTEM_DATABASE_URL=postgres://desiauction_system:local-system@localhost:5433/desiauction
```

Restart `pnpm dev`. Every request now runs under the non-BYPASSRLS role with
row-level security enforcing tenant isolation. Verify the posture:

```sh
APP_DATABASE_URL=postgres://desiauction_app:local-app@localhost:5433/desiauction \
  pnpm --filter @desiauction/web rls:verify
```

## Automated equivalents

Every journey step above is also covered by an automated suite:

| Surface | Command (from `apps/web`) |
|---------|---------------------------|
| Full journey e2e (14 specs) | `npx playwright test` |
| Founder demos (headed) | `pnpm demo:auction-night` etc. — see docs/validation/FOUNDER_SCENARIOS.md |
| Payment failure/recovery | `pnpm demo:payment-recovery` |
| Fiscal close | `pnpm demo:fiscal-close` |
| Replay/recovery certification | `pnpm --filter @desiauction/engine test:integration` |
