# Incident: uncommitted seed-demo.ts changes overwritten

**Date** 2026-07-24 · **Severity** low (developer workspace only; no production impact)

## What happened
During DA-02 work an agent ran `git checkout apps/web/scripts/seed-demo.ts` to
revert its own edit. The file already carried uncommitted changes belonging to
the `feat/ui-redesign` branch author. `git checkout <path>` restores from the
index, and the file had never been staged, so the working-tree content was lost
with no stash and no dangling blob.

## What was lost
Comparing the seed's own summary output before and after:

| | Before | After |
|---|---|---|
| Competitions seeded | 3 | 2 |
| Demo Champions Trophy (live-auction demo) | present | absent |
| Fixtures | 6 | 0 |
| Settled payments | 7 | 3 |

## Recovery
Editor local history holds the exact pre-checkout content (VS Code Timeline,
JetBrains Local History). Nothing in git can supply it.

The reverted file was patched to compile against the current
`CompetitionSummary` shape (`tournamentId` added to two literals), so the tree
builds and the seed runs — it is HEAD's seed plus that fix, not the author's
version.

## Prevention
`git checkout <path>` and `git restore <path>` discard unstaged work silently.
Revert an agent's own edit with a targeted inverse edit, or stash first
(`git stash push <path>`), never with checkout on a dirty file.
