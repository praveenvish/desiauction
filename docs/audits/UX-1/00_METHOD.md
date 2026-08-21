# UX-1 — Method, and what each instrument can and cannot see

**Date:** 2026-08-21 · **Branch:** `feat/ui-redesign` · **Build:** `next dev` on :3100 + engine on :4000, demo seed

The brief asked for a first-principles redesign on the premise that the interface
was roughly 2/10. That premise did not survive contact with the repository, so
the work was re-scoped, with the founder's agreement, to **audit first and then
fix what the audit actually finds** — no speculative teardown of a system that is
tested, documented and accessible.

What the repository actually contains, before any of this work:

- 79 routed surfaces, 49 tables, four apps and eight packages
- a real DTCG token pipeline (`style-dictionary` → `primitives.css` + two themes),
  generated files committed and CI-checked for drift
- 56 semantic tokens per theme, including money-, ceremony- and identity-specific
  families, exercised on a live `/gallery` reference page
- ten shared primitives, four shells, a live-region announcer and a motion
  grammar with a stated reduced-motion policy
- 80 passing end-to-end specs, several of which already run axe

## The instruments

Five probes, written for this audit and kept in `apps/web/scripts/audit/`, so the
numbers below can be reproduced rather than believed.

| Probe | What it does | What it cannot see |
| --- | --- | --- |
| `sweep.mjs` | Every route at **all twelve target widths** (320→1920): document overflow, target sizes, heading structure, metadata, console/page errors; axe at 390 and 1440 | Anything requiring interaction; anything in the other theme |
| `contrast.mjs` | Recomputes contrast from **composited** colours in **both themes**, and counts axe's own abstentions | Text over a gradient — see below |
| `pixels.mjs` | Screenshots an element and reads the **actual painted RGB** | Only runs on a shortlist; slow |
| `linkcheck.mjs` | Every anchor and button, both themes, looking for user-agent default colours | Colour only |
| `keyboard.mjs` | Presses Tab for real and records focus order, visible indicators, off-screen stops | Screen-reader output quality |

### One instrument was wrong, and it matters

`contrast.mjs` computes the backdrop by walking up for an opaque
`background-color`. A **gradient has none**, so on every hero and every dark band
it kept climbing and compared white text against a pale surface three ancestors
away — producing dozens of impossible 1.07:1 readings on copy that is plainly
legible in the screenshots.

Those are the probe's failure, not the product's. Every gradient-backed reading
was discarded, and the shortlist that survived was re-settled by
`pixels.mjs`, which models nothing and reads the pixels that were painted.

**This is why the audit reports far fewer contrast defects than the raw probe
output suggests.** Two of the survivors were then confirmed a third way, in the
source. A finding is listed below only where at least two independent methods
agree.

## What was checked by hand

Automation does not answer whether a screen is *good*. Every 390 / 768 / 1440
screenshot was reviewed, and the following were traced through source rather
than measured: the bid command path and its failure handling, the refusal-copy
dictionary, the navigation model, role-based data gating, the readiness verdict,
and the reduced-motion policy against the files that animate.

## Known gaps in this audit

Stated so the verdict is not read as broader than the evidence:

- **The bidding moment itself was not driven end to end.** A live auction needs
  two claimed paddles and a queued lot; the room was inspected in its SOLD and
  connecting states, and the bid path was read in source. The e2e suite covers
  the interaction.
- **Screen-reader output was not listened to.** Semantics were checked (axe,
  roles, live regions, labels); how a real reader narrates them was not.
- **Six routes were missed by the floodlight contrast pass** when the dev server
  hit its memory ceiling and restarted mid-run. They were covered in daylight and
  by `linkcheck`.
- **`next dev` timings are compile times, not performance.** Everything in the
  performance section was measured against a production build.
