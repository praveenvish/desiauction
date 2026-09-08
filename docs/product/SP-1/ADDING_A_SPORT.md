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

Nothing else is needed. The guardrails pick a new pack up automatically:
`registry.test.ts` iterates every registered sport and will fail if two roles
share a label or one alias points at two roles; `sport-vocabulary.test.ts` fails
if the new sport's words appear anywhere outside `sports/`.

---

## What you do NOT have to touch

The sport picker, the registration form, the results form, the standings table,
the admin catalogue, `/account`'s per-sport panels, the auction, the purse,
settlement, or any schema. All of it reads the pack.

## What is still not a pack file

**Racquet sports** — badminton, table tennis, tennis, pickleball. A team tie is
several **rubbers** (singles, doubles), not one scoreline, and
`fixture_results.score` holds `{ home, away }`. That needs a new `fixtureShape`
and a matching score shape: real work, not data.
