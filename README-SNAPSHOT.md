# Changed files only — this is not a working tree

An orphan branch carrying **only the files two pieces of work touched**, with no
project history behind them. It exists so the work can be shared without
publishing the rest of the codebase or its ~237 commits.

**It does not build and it does not run.** There is no `package.json` at the
root of what you see unless a change happened to touch it, no lockfile, no
source outside the changed paths. Do not `pnpm install` here and do not judge a
file by what is missing around it. `git diff` against this branch is also
meaningless — with no ancestor, every line reads as new.

The full, buildable history lives on two branches in the origin working copy:

| Branch | Commits | What |
|---|---|---|
| `fix/prr-remediation` | 9 | Production go-live audit remediation |
| `fix/guesthome-design` | 3 | Public landing page (`/`) design pass |

Both branch from `8f2c57f` on `feat/ui-redesign`, and they are independent of
each other — neither needs the other to merge.

## What the 12 commits contain

Read them with `git log`. The messages carry the reasoning; the headlines:

**Remediation** — a Postgres advisory lock so a second engine instance refuses
to boot (the single-writer guarantee was previously `fly.toml` plus discipline);
migrations 0029/0030 closing a double-sell race and promoting TypeScript-only
invariants to real constraints; a Razorpay refund that was booked twice; a
payment intent that could buy two gateway orders; four authorization holes; a
tier ceiling the batch path skipped. One commit is a *decision record* for a fix
that was implemented and then reverted, because the integration suite proved it
broke anti-snipe.

**Landing** — two defects that existed only at runtime: the header went fully
transparent for reduced-motion users and every non-Chromium browser (~1.07:1
contrast, and invisible to the axe run, which scans at scroll 0 over a dark
hero), and every card's hover lift was inert because a filled scroll-timeline
animation outranked it. Plus section rhythm above 1280px, orphaned grid rows on
tablet, three sizes of one heading level, and a 41×16px tap target.

## Verification that was run against the real branches

`pnpm verify` green (lint, typecheck, unit, format, dependency boundaries) ·
web integration 658/658 · engine integration 66/66 · all 31 migrations applied
from an empty database and each new constraint proven behaviourally in psql ·
two real engine processes booted to prove the second is refused · the landing
measured at six viewports for overflow, tap targets and reduced-motion content
loss · `axe` clean on `/`.

None of that can be reproduced from this branch. That is the trade it makes.
