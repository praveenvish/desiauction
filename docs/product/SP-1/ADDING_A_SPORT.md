# ADDING A SPORT

## DesiAuction NEXT · SP-1 · for whoever wants the fifth sport

A sport is **one file of data plus one line of SQL**. There is no code to write:
every pack in the tree — cricket, football, kabaddi, volleyball — now contains
**zero functions**. Copy the nearest one, change the words, done.

---

## Why it is a file and not an admin screen

The honest reason, because it is a fair question and the answer is not "we
didn't get round to it".

A sport is not a list of names. It is a set of rules that decide a league table,
and the rules have edges. Volleyball ranks teams on sets won ÷ sets lost — so a
team that has **not lost a set divides by zero**. The two answers any form would
naturally store, `null` and `0`, both sort that team to the **bottom** of the
table. Quietly. All season. The league's only unbeaten side finishes last and
nobody notices until week nine.

That was got right because it could be written, reasoned about, and pinned by
four tests. A data-entry screen would have shipped it.

So the rules stay in a file, where they are reviewed, type-checked and tested —
but the file is now **data**, which means you can write it. The arithmetic that
was easy to get wrong lives in `tiebreakers.ts` and is shared, so no new sport
can get it wrong again.

---

## Step 1 — the pack

Copy `packages/core/src/sports/kabaddi.ts` (the smallest, 66 lines) and change
the words. Here is the whole shape:

```ts
export const HOCKEY_ROLE_KEYS = ["goalkeeper", "defender", "midfielder", "forward"] as const;
export type HockeyRole = (typeof HOCKEY_ROLE_KEYS)[number];

export const HOCKEY: SportPack = {
  key: "hockey",
  label: "Hockey",

  roles: {
    required: true,                       // false if the sport has no positions
    values: termsOf(HOCKEY_ROLE_KEYS, {
      goalkeeper: { label: "Goalkeeper", aliases: ["gk", "keeper", "goalie"] },
      defender:   { label: "Defender",   aliases: ["def", "back", "full back"] },
      midfielder: { label: "Midfielder", aliases: ["mid", "half", "link"] },
      forward:    { label: "Forward",    aliases: ["fwd", "striker", "attacker"] },
    }),
  },

  attributes: [],                         // see "attributes" below

  result: {
    scoreFields: [{ key: "goals", label: "Goals", min: 0, max: 99 }],
  },

  standings: {
    points: { win: 3, tie: 1, loss: 0, noResult: 1 },
    tiebreakers: [difference("goals", "GD"), total("goals", "GF")],
    summariseSide: summariseFields("{goals}"),
  },

  terms: {
    participant: ["Player", "Players"],
    squad: "Squad",
    fixture: "Match",
    ground: "Pitch",                      // Ground · Pitch · Mat · Court …
  },
};
```

### roles

The keys are what the database stores; the labels are what people see; the
aliases are **every spelling a club writes on a registration form**. Aliases are
where the value is: an organizer importing a spreadsheet full of "CB", "RWB" and
"full back" gets defenders and retypes nothing.

Keep the list to the roles an **auction** cares about. A team sheet
distinguishes a left-back from a right-back; an owner is just short of a
defender. Football folds six positions into four this way; kabaddi folds the
corners and covers into one.

### attributes

A per-player fact clubs actually record — cricket's batting style, football's
preferred foot, volleyball's spiking hand. **Leave it `[]` if the sport has
none.** Kabaddi does exactly that: inventing a "raiding hand" would put a field
on the form nobody can fill.

```ts
attributes: [
  {
    key: "preferred_foot",
    label: "Preferred foot",
    storage: { kind: "json" },            // always json for a new sport
    headerAliases: ["preferred foot", "strong foot", "foot"],
    options: termsOf(FOOT_KEYS, {
      right: { label: "Right footed", aliases: ["righty"] },
      left:  { label: "Left footed",  aliases: ["lefty"] },
    }),
  },
],
```

### scoreFields

The numbers on a finished scoreboard. One for most sports (`goals`, `points`),
three for cricket (`runs`, `wickets`, `balls`), two for volleyball (`sets`,
`points`). `min`/`max` are a **typo net, not a rulebook** — the point past which
a number is certainly a slipped finger.

If a component is *typed* differently from how it is *stored*, add `entry` and
`parse`. Cricket is the only sport that needs this so far: scorers write overs
("18.3"), the table needs balls (111).

### tiebreakers

Pick from the shared library — **do not write the arithmetic**:

| Helper | Does | Used by |
|---|---|---|
| `difference("goals", "GD")` | scored − conceded | football, kabaddi |
| `total("goals", "GF")` | total scored | football, kabaddi |
| `ratio("sets", "Sets")` | scored ÷ conceded, **handling the unbeaten team** | volleyball |
| `netRate("runs", "balls", 6, "NRR")` | rate per N, both sides, subtracted | cricket |

They apply **in order**, after points. If your sport genuinely ranks on
something none of these express, write a `TiebreakerSpec` by hand — that is what
the escape hatch is for, and needing it is a fact about the sport.

### points

`{ win, tie, loss, noResult }`. Use the ordinary club scheme, not a professional
league's. Kabaddi ships 2/1/0 rather than the Pro Kabaddi League's
5/3/1-with-a-bonus, because defaulting to PKL's would impose it on every club
league that is not PKL.

**Known limit:** a scheme that depends on the *score* — volleyball's real
3/2/1, where a 3-2 win is worth less than a 3-0 — cannot be expressed. See
`volleyball.ts`.

### terms

Four words. Only `ground` has ever differed in practice: Ground, Pitch, Mat,
Court.

---

## Step 2 — register it

Two lines in `packages/core/src/sports/index.ts`:

```ts
import { HOCKEY } from "./hockey";
export const SPORTS: readonly SportPack[] = [CRICKET, FOOTBALL, KABADDI, VOLLEYBALL, HOCKEY];
```

## Step 3 — switch it on

One migration, e.g. `packages/db/migrations/0051_hockey.sql`:

```sql
INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('hockey', 'Hockey', true, 4);
```

Then add its entry to `migrations/meta/_journal.json` — **the `when` value must
be larger than the entry above it**, or drizzle silently skips the file.

## Step 4 — run the tests

```bash
pnpm verify
```

Nothing else is needed, and the guardrails pick a new pack up automatically —
you do not add yourself to a list anywhere:

- `registry.test.ts` iterates every registered sport and fails if two roles
  share a label or one alias points at two roles;
- `sport-vocabulary.test.ts` fails if the new sport's words appear anywhere
  outside `sports/`;
- `pack-contract.test.ts` fails if your pack declares a function instead of
  using a helper, **or if you did Step 1 and 2 and forgot Step 3** — which is
  the mistake worth protecting against, because without the migration your
  sport simply does not appear in the picker and nothing else complains. It
  also catches a migration label that disagrees with the pack's, and two sports
  given the same `sort_order`.

---

## What you do NOT have to touch

The sport picker, the registration form, the results form, the standings table,
the admin catalogue, `/account`'s per-sport panels, the auction, the purse,
settlement, or any schema. All of it reads the pack.

## What is still not a pack file

**Nothing that has been asked for.** Both claims this section used to carry are
closed, and both are worth reading as a warning about inherited notes.

**Racquet sports were never blocked.** This said a team tie is several rubbers
rather than one scoreline and so needed a new `fixtureShape`. The first half is
true and the conclusion did not follow: a tie's RESULT is one scoreline per side
— rubbers won, and games won inside them — which is what volleyball has done
with sets and points since Phase 4. Badminton, table tennis and pickleball
shipped in 0056 as ordinary pack files with **no code change at all**.
Retracted 2026-09-09, after a throwaway probe that should have been run when the
claim was first written.

**Battle royale was, and is not now.** A lobby is sixteen to twenty-five squads
scored on placement plus kills, with no home and no away, and no arrangement of
score fields reaches that — the shape was in the schema. `fixtureShape:
"lobby"` (0058/0059) is what it needed: `fixture_participants`, nullable sides,
a fold over placements, and a fixtures UI that draws a lobby. See
`PHASE-5_NOTES.md`.

**A lobby sport costs slightly more than a duel sport.** The pack file, the two
lines in `sports/index.ts` and the seed migration are the same; the pack also
sets `fixtureShape: "lobby"` and `standings.lobby` (placement points, and points
per unit of any score field). Everything downstream — the create form, the
placement form, the fold, the table — already reads those.

## What genuinely has no home yet

Recording **who** played: who batted, who took the third rubber, which four
players were in the squad that placed second. That is a scorecard with line-ups,
and no sport here has one — cricket cannot say who batted either. It is a
missing feature for every sport equally, not a limit on any particular one.
