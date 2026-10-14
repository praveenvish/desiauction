# LS-1 · 01 · Contracts (source of truth for every name)

Every identifier in this file is binding: table names, columns, event types, field names, route paths, test ids. `02-commits.md` refers to these by section ID (for example D-2, E-4, R-17).

---

## D · Database

All migrations are hand-authored in `packages/db/migrations/`. Each one starts with the header comment `-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.` and then a rationale paragraph. Statements end with `--> statement-breakpoint`.

Each migration is mirrored by hand in `packages/db/src/schema.ts`, using the helpers `id()` and `ts()` (lines 26-27). Every new table is also added to `apps/web/src/server/test-support/purge-org.ts`, in the import list and in the delete order with children before parents.

Planned numbers. Renumber per trap T1 if `main` moved.

| File | idx | when | Commit |
|---|---|---|---|
| `0112_ls1_match_core.sql` | 111 | 1793376000000 | C13 |
| `0113_ls1_people_on_match.sql` | 112 | 1793462400000 | C14 |
| `0114_ls1_scorer_grant_and_result_source.sql` | 113 | 1793548800000 | C14 |
| `0115_ls1_move_tournament_tables.sql` | 114 | 1793635200000 | C15 |
| `0116_ls1_lines_and_awards.sql` | 115 | 1793721600000 | C35 |
| `0117_ls1_previous_career.sql` | 116 | 1793808000000 | C37 |
| `0118_ls1_trust.sql` | 117 | 1793894400000 | C38 |
| `0119_ls1_personal_org.sql` | 118 | 1793980800000 | C40 |
| `0120_ls1_team_formation.sql` | 119 | 1794067200000 | C41 |
| `0121_ls1_ball_facts.sql` | 120 | 1794153600000 | C42 |
| `0122_ls1_move_tournament_tables_2.sql` | 121 | 1794240000000 | C42 |

### D-1 `matches` (0112)

One row per scored fixture. Created when scoring starts.

```sql
CREATE TABLE "matches" (
  "fixture_id" char(26) PRIMARY KEY,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "attempt" integer NOT NULL DEFAULT 1,
  "format" jsonb NOT NULL,                 -- FormatSpec snapshot (F-1), frozen at start
  "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Conditions (F-2) at start; changes are events
  "award_version" text NOT NULL,           -- e.g. 'cricket-v1/t20'
  "phase" text NOT NULL DEFAULT 'not_started',
  "scorer_person_id" char(26),             -- the scoring claim holder (C-claim)
  "scorer_claimed_at" timestamp with time zone,
  "scorer_device_id" text,                 -- opaque id from the client, for the claim
  "trust_level" text NOT NULL DEFAULT 'self_scored',
  "share_token" text NOT NULL,             -- 32 chars base64url, random
  "last_seq" bigint NOT NULL DEFAULT 0,
  "viewer_peak" integer NOT NULL DEFAULT 0,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "finalized_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matches_phase_check" CHECK ("phase" IN ('not_started','toss','live','innings_break','interrupted','result_reached','finished','final','stalled','no_result','abandoned','walkover','void')),
  CONSTRAINT "matches_trust_check" CHECK ("trust_level" IN ('verified','confirmed','self_scored','flagged')),
  CONSTRAINT "matches_attempt_check" CHECK ("attempt" >= 1)
);
```

- FKs:
  - `fixture_id → fixtures(id) ON DELETE CASCADE`;
  - `scorer_person_id → people(id) ON DELETE SET NULL`.
- Unique index `matches_share_token_uq (share_token)`.
- Index `matches_competition_idx (competition_id)`.
- RLS: `ENABLE` + `FORCE`, policy `matches_tenant`, org equality (INV-03).

### D-2 `match_events` (0112)

The append-only log.

```sql
CREATE TABLE "match_events" (
  "fixture_id" char(26) NOT NULL,
  "seq" bigint NOT NULL,
  "event_id" char(26) NOT NULL,            -- ULID chosen by the client; idempotency key
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "attempt" integer NOT NULL,
  "type" text NOT NULL,                    -- E-2
  "v" smallint NOT NULL DEFAULT 1,         -- payload schema version
  "payload" jsonb NOT NULL,
  "target_event_id" char(26),              -- for 'void' and 'amend' only
  "actor_person_id" char(26) NOT NULL,
  "client_seq" integer NOT NULL,
  "client_recorded_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_events_pkey" PRIMARY KEY ("fixture_id","seq")
);
```

- Unique index `match_events_event_uq (fixture_id, event_id)`.
- Index `match_events_competition_idx (competition_id)`.
- FKs:
  - `fixture_id → fixtures CASCADE`;
  - `actor_person_id → people RESTRICT`.
- RLS: tenant policy.
- **Append-only (INV-04):** a guarded `REVOKE UPDATE, DELETE ON match_events FROM desiauction_app, desiauction_engine, desiauction_runner, desiauction_system` in the migration, using the `DO $$ … FOREACH role_name …` pattern from 0085, which revokes only for roles that exist. Add `match_events` to `ops/db/create-app-role.sql` line 236 and to `APPEND_ONLY` in `apps/web/scripts/verify-grants.ts`.
- Also add `REVOKE ALL ON matches, match_events, match_live_state FROM desiauction_engine, desiauction_runner` (guarded) and the same line in `create-app-role.sql` next to line 270.

### D-3 `match_live_state` (0112)

One row per match, written in the append transaction. Public reads go by primary key.

```sql
CREATE TABLE "match_live_state" (
  "fixture_id" char(26) PRIMARY KEY,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "seq" bigint NOT NULL,
  "state" jsonb NOT NULL,                  -- PublicLiveState (S-5)
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

FK `fixture_id → fixtures CASCADE`. RLS: tenant policy.

### D-4 `team_managers` (0113)

Who may act for a team outside the auction.

```sql
CREATE TABLE "team_managers" (
  "id" char(26) PRIMARY KEY,
  "team_id" char(26) NOT NULL,
  "person_id" char(26) NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "role" text NOT NULL,          -- 'captain' | 'manager'
  "source" text NOT NULL,        -- 'auction_owner' | 'organizer' | 'team_entry'
  "created_by" char(26) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "team_managers_role_check" CHECK ("role" IN ('captain','manager')),
  CONSTRAINT "team_managers_source_check" CHECK ("source" IN ('auction_owner','organizer','team_entry'))
);
```

- Partial unique `team_managers_active_uq (team_id, person_id) WHERE revoked_at IS NULL`.
- FKs:
  - `team_id → teams CASCADE`;
  - `person_id → people RESTRICT`;
  - `created_by → people RESTRICT`.
- **Policy `team_managers_tenant`:**
  - `USING (org_id = current_setting('app.org_id', true) OR person_id = current_setting('app.person_id', true))`;
  - `WITH CHECK (org_id = current_setting('app.org_id', true))`.

  This is the same shape as `registrations_tenant`.

### D-5 `fixture_officials` (0113)

```sql
CREATE TABLE "fixture_officials" (
  "id" char(26) PRIMARY KEY,
  "fixture_id" char(26) NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "role" text NOT NULL,          -- 'scorer' | 'umpire' | 'referee' | 'commentator'
  "person_id" char(26),
  "display_name" text NOT NULL,
  "created_by" char(26) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "removed_at" timestamp with time zone,
  CONSTRAINT "fixture_officials_role_check" CHECK ("role" IN ('scorer','umpire','referee','commentator'))
);
```

- FKs:
  - `fixture_id → fixtures CASCADE`;
  - `person_id → people RESTRICT`;
  - `created_by → people RESTRICT`.
- Index `(fixture_id)`.
- RLS: tenant policy.

### D-6 Grants and result source (0114)

- Drop and re-add the grants constraint:
  ```sql
  ALTER TABLE "grants" DROP CONSTRAINT "grants_tournament_scope_is_conductor";
  ALTER TABLE "grants" ADD CONSTRAINT "grants_tournament_scope_capability_check"
    CHECK ("scope_type" <> 'tournament' OR "capability_set" IN ('auction:conductor','fixture:scorer'));
  ```
- Add the result source:
  ```sql
  ALTER TABLE "fixture_results" ADD COLUMN "source" text NOT NULL DEFAULT 'typed';
  ALTER TABLE "fixture_results" ADD CONSTRAINT "fixture_results_source_check" CHECK ("source" IN ('typed','scored'));
  ```

### D-7 Season rules on `competitions` (0114)

```sql
ALTER TABLE "competitions" ADD COLUMN "scoring_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
```

`scoring_rules` is a `SeasonScoringRules` (F-3).

Backfill for existing rows sets the legacy NRR behaviour:
```sql
UPDATE competitions SET scoring_rules = '{"allOutUsesQuota":false,"excludeNoResultFromNrr":false}';
```

New seasons are created with the F-3 defaults (all true), set by application code at creation.

### D-8 `move_tournament` (0115 and 0122)

`CREATE OR REPLACE FUNCTION platform_move_tournament(char, char, char, text, char, char, char, text)`.
- Copy the **entire** current body from `0109_move_single_season.sql`.
- Add the line `UPDATE <table> SET org_id = p_target_org WHERE competition_id = ANY (v_comps);` for each of:
  - `matches`, `match_events`, `match_live_state`, `team_managers`, `fixture_officials` (in 0115);
  - `match_player_lines`, `match_awards`, `ball_facts`, `match_confirmations` (in 0122).
- `match_events` is append-only for the app role. The function is `SECURITY DEFINER` (owner), so the UPDATE is allowed there; keep it that way.
- Extend `apps/web/src/posture/move-tournament.posture.test.ts` so it asserts that each table's rows moved.

### D-9 `match_player_lines` and `match_awards` (0116)

```sql
CREATE TABLE "match_player_lines" (
  "fixture_id" char(26) NOT NULL,
  "registration_id" char(26) NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "team_id" char(26) NOT NULL,
  "sport" text NOT NULL,
  "format_key" text NOT NULL,
  "conditions" jsonb NOT NULL,
  "stats" jsonb NOT NULL,           -- PlayerLine (S-6)
  "points" numeric(8,2) NOT NULL,   -- award points (A-1)
  "points_lines" jsonb NOT NULL,    -- AwardLine[] (A-2)
  "trust_level" text NOT NULL,      -- copy of matches.trust_level at write
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_player_lines_pkey" PRIMARY KEY ("fixture_id","registration_id")
);
```

- Indexes: `(registration_id)`, `(competition_id)`.
- FKs:
  - fixture → CASCADE;
  - registration → CASCADE;
  - team → RESTRICT.
- RLS: tenant policy with a person arm via registrations:
  ```sql
  USING (org_id = current_setting('app.org_id', true)
         OR registration_id IN (SELECT id FROM registrations
                                WHERE person_id = current_setting('app.person_id', true)))
  WITH CHECK (org_id = current_setting('app.org_id', true))
  ```
- If `rls:verify` flags this as non-org-equality, add `match_player_lines` to `PARTICIPANT_SCOPED` in `apps/web/scripts/verify-rls.ts` **with a proof query** mirroring how `auction_team_targets` is proven.

```sql
CREATE TABLE "match_awards" (
  "id" char(26) PRIMARY KEY,
  "fixture_id" char(26),               -- null for season awards
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "scope" text NOT NULL,               -- 'match' | 'season'
  "kind" text NOT NULL,                -- A-3
  "computed_registration_id" char(26), -- system pick
  "winner_registration_id" char(26),   -- shown winner
  "source" text NOT NULL,              -- 'auto' | 'organizer' | 'fans'
  "reason" text,
  "score" numeric(8,2),
  "actor_person_id" char(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_awards_scope_check" CHECK ("scope" IN ('match','season')),
  CONSTRAINT "match_awards_source_check" CHECK ("source" IN ('auto','organizer','fans'))
);
```

- Append-only (INV-04 treatment: migration revoke, recipe and APPEND_ONLY). The current award for a `(scope, fixture_id|competition_id, kind)` is the latest row.
- RLS: tenant policy.

### D-10 `player_previous_careers` (0117)

Self-reported history from other apps. Never counted on boards.

```sql
CREATE TABLE "player_previous_careers" (
  "person_id" char(26) NOT NULL,
  "sport" text NOT NULL,
  "summary" jsonb NOT NULL,        -- {matches?, runs?, wickets?, fromYear?, toYear?, source?: string}
  "screenshot_key" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "player_previous_careers_pkey" PRIMARY KEY ("person_id","sport")
);
```

- This table is person-scoped, the same pattern as `player_profiles`: **no RLS**, and the module self-scopes by person.
- Add it to `APP_WRITES_PERSON` in `verify-grants.ts` and to `REVOKE ALL … FROM engine, runner`.

### D-11 Trust (0118)

```sql
CREATE TABLE "match_confirmations" (
  "id" char(26) PRIMARY KEY,
  "fixture_id" char(26) NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  "team_id" char(26) NOT NULL,
  "person_id" char(26) NOT NULL,
  "verdict" text NOT NULL,           -- 'confirmed' | 'disputed'
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_confirmations_verdict_check" CHECK ("verdict" IN ('confirmed','disputed'))
);
CREATE UNIQUE INDEX "match_confirmations_one_uq" ON "match_confirmations" ("fixture_id","team_id");
ALTER TABLE "matches" ADD COLUMN "trust_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb;  -- TrustReason[] (T-2)
```

RLS: tenant policy.

### D-12 Personal organisations (0119)

```sql
ALTER TABLE "organizations" ADD COLUMN "kind" text NOT NULL DEFAULT 'club';
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_kind_check" CHECK ("kind" IN ('club','personal'));
CREATE UNIQUE INDEX "organizations_personal_owner_uq" ON "organizations" ("created_by") WHERE "kind" = 'personal';
```

### D-13 Team formation (0120)

```sql
ALTER TABLE "competitions" ADD COLUMN "team_formation" text NOT NULL DEFAULT 'auction';
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_team_formation_check" CHECK ("team_formation" IN ('auction','organizer','team_entry'));
ALTER TABLE "competitions" ADD COLUMN "entry_code" text;   -- 6 chars [A-HJ-NP-Z2-9], unique when not null
CREATE UNIQUE INDEX "competitions_entry_code_uq" ON "competitions" ("entry_code") WHERE "entry_code" IS NOT NULL;
CREATE TABLE "team_entries" (
  "id" char(26) PRIMARY KEY, "org_id" char(26) NOT NULL, "competition_id" char(26) NOT NULL,
  "team_name" text NOT NULL, "captain_person_id" char(26) NOT NULL,
  "players" jsonb NOT NULL,          -- [{name, phone?}] max 30
  "status" text NOT NULL DEFAULT 'submitted',  -- 'submitted'|'approved'|'rejected'
  "reviewed_by" char(26), "reviewed_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "team_entries_status_check" CHECK ("status" IN ('submitted','approved','rejected'))
);
```

`team_entries` gets the tenant policy plus a person arm on `captain_person_id`.

### D-14 `ball_facts` (0121)

The analytics projection. One row per delivery, written at finalize.

```sql
CREATE TABLE "ball_facts" (
  "fixture_id" char(26) NOT NULL, "seq" bigint NOT NULL,
  "org_id" char(26) NOT NULL, "competition_id" char(26) NOT NULL,
  "innings_no" smallint NOT NULL, "over_no" smallint NOT NULL, "ball_in_over" smallint NOT NULL,
  "legal" boolean NOT NULL, "phase" text NOT NULL,            -- 'powerplay'|'middle'|'death'
  "batter_id" char(26) NOT NULL, "batter_hand" text,          -- 'right'|'left'|null
  "bowler_id" char(26) NOT NULL, "bowler_style" text,         -- CRICKET_BOWLING_STYLE_KEYS|null
  "runs_bat" smallint NOT NULL, "extras" smallint NOT NULL, "extra_kind" text,  -- 'wide'|'no_ball'|'bye'|'leg_bye'|null
  "boundary" smallint,                                         -- 4|6|null
  "zone" text, "angle" smallint,                               -- ZoneKey|null, 0..359|null
  "wicket_kind" text, "player_out_id" char(26), "fielder_id" char(26), "wicket_x" real, "wicket_y" real,
  "time_of_day" text, "ball_type" text, "ground_type" text, "pitch" text,
  "trust_level" text NOT NULL,
  "format_key" text NOT NULL,
  CONSTRAINT "ball_facts_pkey" PRIMARY KEY ("fixture_id","seq")
);
```

- Indexes: `(batter_id)`, `(bowler_id)`, `(competition_id)`.
- RLS: tenant policy plus a person arm via registrations for `batter_id`/`bowler_id`, the same shape as D-9.

---

## E · Event model

### E-1 Envelope

Shared by client, server and DB. The TypeScript lives in `packages/core/src/scoring/types.ts`.

```ts
export interface MatchEvent<T extends EventType = EventType> {
  readonly eventId: string;          // ULID (client)
  readonly seq: number;              // server order; 0 while unsynced on the client
  readonly attempt: number;
  readonly type: T;
  readonly v: 1;
  readonly payload: PayloadOf<T>;
  readonly targetEventId: string | null;   // void | amend only
  readonly actorPersonId: string;
  readonly clientSeq: number;
  readonly clientRecordedAt: string;       // ISO
}
```

Player references are always **registration ids** (`registrations.id`), never person ids and never names.

### E-2 Delivery-family event types (cricket, box cricket)

Every type has a hand-written validator `validate<Type>(payload): ValidationResult`. The result is `{ok:true} | {ok:false; reason: RejectReason; detail?: string}`.

| `type` | Payload (all fields required unless marked `?`) |
|---|---|
| `match_started` | `{ format: FormatSpec; conditions: Conditions; homeTeamId: string; awayTeamId: string; superOverTie?: SeasonScoringRules['superOverTie'] }` |
| `lineup_confirmed` | `{ teamId; battingOrder: string[] /* ≥2, ≤ format.playersPerSide + 4 */; captainId: string; keeperId: string; substitutes: string[] }` |
| `toss` | `{ winnerTeamId: string; decision: 'bat' \| 'bowl' }` |
| `innings_started` | `{ inningsNo: number /* positive safe integer, exact next scheduled */; battingTeamId; strikerId; nonStrikerId: string \| null /* lone batter only */; bowlerId; superOver?: boolean }` |
| `ball` | See E-3 |
| `new_batter` | `{ registrationId; end: 'striker' \| 'non_striker' }` |
| `bowler_set` | `{ bowlerId; midOver: boolean; reason?: 'injury'\|'suspended'\|'other' }` |
| `strike_swapped` | `{}` |
| `retire` | `{ registrationId; kind: 'hurt' \| 'out' }` |
| `resume_batting` | `{ registrationId }` |
| `penalty_runs` | `{ teamId; runs: 5; reason: 'fielding'\|'helmet'\|'time_wasting'\|'pitch_damage'\|'other' }` |
| `substitute` | `{ teamId; inId; outId; kind: 'injury'\|'concussion'\|'impact'\|'tactical' }` |
| `player_added` | `{ teamId; registrationId }` (a late/guest player already registered via the API; see API-6) |
| `conditions_changed` | `{ conditions: Partial<Conditions> }` (applies from the next ball) |
| `style_set` | `{ registrationId; battingHand?: 'right'\|'left'; bowlingStyle?: BowlingStyleKey }` |
| `interrupt` | `{ reason: 'rain'\|'bad_light'\|'other'; note?: string }` |
| `resume` | `{}` |
| `revise` | `{ inningsNo; maxBalls: number; targetRuns?: number; method: 'manual'\|'dls' }` |
| `innings_closed` | `{ reason: 'declared'\|'forfeit'\|'no_more_batters' }` (normal ends are derived, not events) |
| `super_over_started` | `{}` |
| `abandon` | `{ kind: 'no_result'\|'abandoned'; reason: string }` (`abandoned` = never started, per the existing schema meaning) |
| `walkover` | `{ winnerTeamId; reason: string }` |
| `restart` | `{ reason: string }` (attempt + 1, rule R-40) |
| `void` | `{}` with `targetEventId` |
| `amend` | `{ payload: <same payload type as the target> }` with `targetEventId` |
| `finish` | `{}` (the scorer confirms that a derived result is final) |

### E-3 The `ball` payload

```ts
export interface BallPayload {
  bowlerId: string; strikerId: string; nonStrikerId: string | null; // null only for lastManStands with a sole remaining batter
  runsBat: number;                       // 0..10, runs credited to the batter (C24 amendment)
  extras: {
    wides?: number;                      // total wide runs incl. the 1 penalty (≥1 when present)
    noBall?: true;                       // the no-ball's own run(s) come from format.noBallRuns
    byes?: number;                       // ≥1 when present
    legByes?: number;                    // ≥1 when present
  };
  boundary?: 4 | 6;                      // only when runsBat is 4/6 AND it was a boundary (not run, not overthrows)
  shot?: { zone: ZoneKey; angle: number };   // angle 0..359 clockwise from 'straight' (bowler's end up), batter's frame already mirrored for LHB
  wicket?: {
    kind: WicketKind; playerOutId: string;
    fielderIds: string[];                // 0..2
    where?: { x: number; y: number };    // -1..1 normalised field coords, (0,0)=batter, y+ = towards bowler
    runsCompleted?: number;              // run out only: runs completed before the run out (already counted in runsBat/byes)
  };
}
export type ZoneKey = 'long_off'|'cover'|'point'|'third_man'|'fine_leg'|'square_leg'|'mid_wicket'|'long_on';
export type WicketKind = 'bowled'|'caught'|'lbw'|'stumped'|'run_out'|'hit_wicket'|'obstructing'|'hit_twice'|'timed_out'|'caught_and_bowled';
```

`retired_*` is not a `WicketKind`; retirements are the `retire` event.

Zone centre angles for a right-hander:

| Zone | Angle |
|---|---|
| long_off | 22 |
| cover | 67 |
| point | 112 |
| third_man | 157 |
| fine_leg | 202 |
| square_leg | 247 |
| mid_wicket | 292 |
| long_on | 337 |

For a left-hander use `360 − angle`. The function is `zoneAngle(zone, hand)` in core.

### E-4 Reject reasons (closed union)

The `RejectReason` union, with the plain-English messages from `scoring/messages.ts`:

| Reason | Message |
|---|---|
| `not_live` | "The match isn't being scored right now." |
| `wrong_attempt` | "This match was restarted. Reload to continue." |
| `unknown_player` | "That player isn't in either XI." |
| `not_batting` | "That batter isn't at the crease." |
| `bowler_not_fielding` | "The bowler must be from the fielding side." |
| `bowler_consecutive` | "{name} bowled the last over. Pick someone else." |
| `bowler_quota` | "{name} has bowled all {n} overs." |
| `illegal_wicket_on_extra` | "That dismissal isn't possible on a {extra}." |
| `free_hit_dismissal` | "Only a run out is possible on a free hit." |
| `runs_out_of_range` | "Runs must be between 0 and 10." |
| `boundary_mismatch` | "A boundary must be 4 or 6 runs off the bat." |
| `innings_over` | "This innings is complete." |
| `no_open_innings` | "Start the innings first." |
| `target_reached` | "The target is reached. Finish the match." |
| `already_finished` | "This match is finished. Corrections go through the organiser." |
| `unknown_target` | "That ball no longer exists." |
| `amend_type_mismatch` | "A correction must keep the same kind of entry." |
| `amend_breaks_later_events` | "That change makes a later ball impossible. Fix the later ball first." |
| `bad_payload` | "That entry is incomplete." |
| `duplicate` | (silent, treated as success) |

---

## F · Formats, conditions, season rules

### F-1 `FormatSpec`

`packages/core/src/scoring/formats.ts`. Values only in packs.

```ts
export interface FormatSpec {
  key: string; label: string;
  oversPerInnings: number | null;   // null = unlimited (multi-day; not offered in UI v1)
  ballsPerOver: number;             // default 6
  playersPerSide: number;           // 11 (box 6..8)
  wicketsPerInnings: number;        // default playersPerSide - 1; lastManStands → playersPerSide
  lastManStands: boolean;
  maxOversPerBowler: number | null;
  noConsecutiveOvers: boolean;      // true
  wideRuns: number;                 // 1
  noBallRuns: number;               // 1
  wideReBowl: boolean;              // true
  noBallReBowl: boolean;            // true
  freeHitOnNoBall: boolean;
  retireAt: number | null;          // auto-prompt "Retire at 25?" (gully); retirement is still an explicit event
  lbw: boolean;                     // false in tennis-ball presets → 'lbw' wicket rejected
  superOver: boolean;
  powerplayOvers: number;           // phase boundaries for ball_facts
  deathFromOver: number;            // 1-based over number where 'death' starts
  innings: 1 | 2;                   // per side (limited overs = 1)
}
```

Presets, exported as `FORMAT_PRESETS`. Keys are stable:

| Key | Values |
|---|---|
| `t20` | 20 overs, 11 players, maxOversPerBowler 4, freeHit true, lbw true, superOver true, powerplay 6, death 16 |
| `t10` | 10 overs, 11 players, max 2, freeHit true, powerplay 3, death 8 |
| `odi` | 50 overs, max 10, powerplay 10, death 41 |
| `six_over` | 6 overs, 8 players, max 1, powerplay 2, death 5 |
| `box_6` | 6 overs, 6 players, lastManStands true, max 1, wideReBowl true, lbw false, powerplay 1, death 5 |
| `tennis_gully` | 8 overs, 8 players, retireAt 25, lbw false, freeHit false, max 2, powerplay 2, death 7 |

`SportPack.scoring` (new optional field in `types.ts`):

```ts
scoring?: { family: 'delivery'|'rally'|'timed'|'raid'|'placement'; depth: 0|1|2; formats: readonly FormatSpec[]; defaultFormat: string; awardTable: string };
```

- `cricket` gets: family `delivery`, depth 2, formats `[t20, t10, odi, six_over, tennis_gully]`, default `t20`, award `cricket-v1`.
- `box_cricket` gets: formats `[box_6, six_over]`, default `box_6`, award `cricket-v1`.

### F-2 `Conditions`

```ts
export interface Conditions {
  timeOfDay?: 'day'|'day_night'|'night';
  ball?: { type: 'leather'|'tennis'|'tape'|'rubber'; colour?: 'red'|'white'|'pink' };   // colour only for leather
  ground?: 'full'|'half'|'box'|'indoor';
  pitch?: 'turf'|'matting'|'astroturf'|'cement';
}
```

Defaults are applied by `defaultConditions(ground, kickoffLocalTime, seasonRules)`:
- timeOfDay:
  - `night` if the kickoff hour is ≥ 18;
  - `day_night` if the kickoff is ≥ 15:00 and the ground has floodlights;
  - otherwise `day`.
- `ground`: `indoor` if `grounds.indoor`, else `full`.
- `pitch`: maps `grounds.surface` (`concrete → cement`, `other → undefined`).

### F-3 `SeasonScoringRules` (`competitions.scoring_rules`)

```ts
export interface SeasonScoringRules {
  formatKey?: string;               // default pack.scoring.defaultFormat
  ball?: Conditions['ball'];        // season default ball
  allOutUsesQuota: boolean;         // default true for new seasons
  excludeNoResultFromNrr: boolean;  // default true for new seasons
  editWindowHours: number;          // default 24
  publicDelaySeconds: number;       // default 60 (betting delay for non-verified matches)
  shotMap: 'every'|'boundaries'|'off';  // default 'every'
  superOverTie: 'another'|'boundary_count';   // default 'another'
  replayReplacesAbandoned: boolean; // default true
}
```

Parse with `parseSeasonScoringRules(raw: unknown): SeasonScoringRules`, which fills defaults. **Missing keys on legacy rows mean `false` for the two NRR flags** (the backfill in D-7 makes this explicit).

---

## S · Fold (the match state machine)

`packages/core/src/scoring/delivery/`: files `state.ts`, `apply.ts`, `validate.ts`, `replay.ts`, `next-actions.ts`, `result.ts`, `lines.ts`, `commentary.ts`, `nrr.ts`.

### S-1 Entry points

```ts
export function replayMatch(events: readonly MatchEvent[]): MatchState;               // ignores events of attempts < latest restart; applies void/amend
export function applyEvent(state: MatchState, event: MatchEvent): ApplyResult;        // {ok:true; state} | {ok:false; reason; detail?}
export function nextActions(state: MatchState): NextAction[];                         // S-4
export function deriveResult(state: MatchState): DerivedResult | null;                // N-1
export function playerLines(state: MatchState): Map<string, PlayerLine>;              // S-6
export function publicLiveState(state: MatchState, names: NameBook): PublicLiveState; // S-5
```

`replayMatch` steps:
1. Sort by `seq`.
2. Drop events whose `attempt` < the max attempt.
3. Build the *effective* list by removing voided events and replacing amended payloads. Amends chain: the latest amend wins.
4. Fold with `applyEvent` from `initialState()`.
5. If an effective event is rejected during replay, the replay throws `ReplayError {seq, reason}`. The server must never store such a sequence (R-50).

### S-2 `MatchState` (abridged; implement every field)

```ts
interface MatchState {
  superOverTie: SeasonScoringRules['superOverTie']; // immutable match_started snapshot; omission means 'another'
  pendingSuperOver: { inningsNo: number; battingTeamId: string }[]; // scheduled pair, consumed by innings_started
  phase: Phase; attempt: number; format: FormatSpec | null; conditions: Conditions;
  teams: { home: string; away: string } | null;
  lineups: Record<teamId, { battingOrder: string[]; captainId; keeperId; substitutes: string[]; out: string[] /* subbed out */ }>;
  toss: { winnerTeamId; decision } | null;
  innings: InningsState[];          // in order, super overs flagged
  currentInnings: number | null;    // index into innings
  interrupted: { reason } | null;
  outcome: 'no_result' | 'abandoned' | 'walkover' | null; walkoverWinner: string | null;
  finished: boolean;                // 'finish' applied
  styles: Record<registrationId, { battingHand?: 'right'|'left'; bowlingStyle?: string }>;
  penaltyRuns: { teamId: string; runs: number; inningsNo: number | null }[];
}
interface InningsState {
  no: number; superOver: boolean; battingTeamId; bowlingTeamId;
  runs: number; wickets: number; legalBalls: number; maxBalls: number | null; target: number | null;
  extras: { wides; noBalls; byes; legByes; penalty };
  strikerId: string | null; nonStrikerId: string | null; bowlerId: string | null;
  batters: Record<id, BatterLine>; bowlers: Record<id, BowlerLine>;
  battedOrder: string[]; outIds: string[]; retiredHurt: string[];
  overs: { bowlerId; balls: BallSummary[] }[];   // per over, for "this over" chips and Manhattan
  fallOfWickets: { runs; wickets; legalBalls; playerOutId }[];
  freeHitNext: boolean; closed: null | 'all_out' | 'overs' | 'target' | 'declared' | 'forfeit' | 'no_more_batters';
  lastBowlerOfPreviousOver: string | null;
  conditionsAtBall: Conditions;
}
```

### S-3 Rules

Each rule has a unit test named `R-xx …` in `packages/core/src/scoring/delivery/rules.test.ts`.

**Balls, runs and extras**
- R-01: A ball is legal unless it is a wide or a no-ball (`wideReBowl`/`noBallReBowl` true). If a re-bowl flag is false, that extra counts as legal.
- R-02: Wide: team runs += `wides`, bowler conceded += `wides`, batter balls faced unchanged, the over's legal count unchanged.
- R-03: No-ball: team += `noBallRuns` + `runsBat` + byes + legByes. Bowler conceded += `noBallRuns` + `runsBat`. Batter runs += `runsBat` and batter balls faced += 1. Not a legal ball.
- R-04: Byes and leg-byes: team += n; batter balls faced += 1 (if legal); bowler unaffected.
- R-05: `penalty_runs`: team extras.penalty += 5 for `teamId`, applied to that team's current or next innings. Never charged to the bowler or credited to a batter.
- R-06: Strike swaps when the runs physically run are odd. Physical runs are `runsBat` (when `boundary` is absent) or byes/legByes, or `wides − 1`.
- R-07: At the end of a legal over (`legalBalls % ballsPerOver === 0`), strike swaps and `bowlerId` becomes null. A new bowler is required (`bowler_set`) before the next ball.

**Bowlers**
- R-08: `noConsecutiveOvers` rejects a `bowler_set` naming the bowler of the previous over (`bowler_consecutive`), except in the first over of an innings.
- R-09: `maxOversPerBowler` rejects a bowler whose completed legal overs = max (`bowler_quota`).

**Wickets**
- R-10: Bowler-credited kinds are `bowled`, `caught`, `caught_and_bowled`, `lbw`, `stumped`, `hit_wicket`. All other kinds are not credited to the bowler.
- R-11: On a wide only `stumped`, `run_out`, `hit_wicket` and `obstructing` are allowed. On a no-ball only `run_out`, `obstructing` and `hit_twice` are allowed. On a free hit only `run_out` and `obstructing` are allowed. Otherwise reject `illegal_wicket_on_extra` / `free_hit_dismissal`.
- R-12: `lbw` is rejected when `format.lbw` is false (`illegal_wicket_on_extra` with detail `lbw_off`).
- R-13: After a wicket the dismissed end is empty. The next ball is rejected (`not_batting`) until `new_batter`, unless the innings is closed (R-15).
- R-14: `retire hurt` empties the end without a wicket; the player may later `resume_batting` into an empty end. `retire out` counts as a wicket with no bowler credit.

**Innings ends**
- R-15: The innings closes when any of these is true:
  - wickets = `wicketsPerInnings` (`all_out`);
  - legal balls = `maxBalls` (`overs`);
  - the 2nd innings runs exceed the target − 1 (`target`);
  - the batting order has no available batter (`no_more_batters`);
  - `innings_closed` is applied.
- R-16: The target for innings 2 = innings 1 runs (incl. penalty) + 1, unless revised by `revise.targetRuns`.
- R-17: `revise` sets `maxBalls` = `maxBalls` from the payload, and `target` when given. A revise is allowed at any time while live.

**Super over**
- R-18: A tie (runs equal, both innings closed) with `format.superOver` true gives phase `result_reached` with `nextActions` offering `start_super_over`.
- R-19: `super_over_started` schedules two 1-over innings (`maxBalls` = `ballsPerOver`, `wicketsPerInnings` 2, `superOver` true). Explicit `innings_started` events select the openers and bowler and consume the scheduled pair in order. The team that batted second in the preceding pair bats first. A pending pair suppresses the result and prevents another super-over start.
- R-20: A super-over tie repeats when `superOverTie='another'`, or is decided by boundary count when `'boundary_count'`.
- R-21: Super-over runs never count toward player lines or NRR (S-6, N-2).

**Lineups and players**
- R-22: `lineup_confirmed` ids must be approved registrations of that team (checked server-side, API-2). In core they must be unique and the count must be ≤ `playersPerSide` + `substitutes.length`.
- R-23: `substitute.inId` must be in that team's `substitutes`. After it the `outId` is in `out` and cannot bat or bowl again. Both get an appearance (S-6).

**Interruptions and outcomes**
- R-24: `interrupt` sets phase `interrupted`. Balls are rejected (`not_live`) until `resume`.
- R-25: `abandon` and `walkover` end the match. Phase becomes `no_result`, `abandoned` or `walkover`.
- R-26: `finish` is accepted only when `deriveResult` is non-null; phase becomes `finished`.
- R-27: Any event after `finish` is rejected (`already_finished`), except `void`/`amend` within the edit window, which the **server** checks (API-1).

**Phase, conditions, styles, attempts and corrections**
- R-28: Phase derivation, in priority order:
  1. void/abandon/walkover outcomes;
  2. `finished`;
  3. `result_reached` (`deriveResult` non-null);
  4. `interrupted`;
  5. `innings_break` (current innings closed and another expected);
  6. `live`;
  7. `toss` (toss done, no innings);
  8. `not_started`.

  `stalled` and `final` are server-only phases (API-8).
- R-29: `conditions_changed` merges into `conditions`. Each ball records `conditionsAtBall`.
- R-30: `style_set` updates `styles`; it never touches the DB profile (the server propagates it, API-7).
- R-40: `restart` increments `attempt`. Events of older attempts are ignored by `replayMatch`; `match_started` must be re-applied in the new attempt.
- R-41: `void` of a ball re-folds as if the ball never happened. Every later event must still apply; otherwise reject `amend_breaks_later_events`.
- R-42: `amend` replaces the payload. Same type only (`amend_type_mismatch`). Later events must still apply.
- R-50: The server stores an event only if `replayMatch(existing ∪ new)` succeeds.

### S-4 `NextAction`

This drives both the pad and the next-step ladder.

```ts
type NextAction =
 | { kind: 'confirm_conditions' } | { kind: 'confirm_lineup'; teamId: string } | { kind: 'record_toss' }
 | { kind: 'start_innings'; inningsNo: number; battingTeamId: string }
 | { kind: 'pick_new_batter'; end: 'striker'|'non_striker'; suggestedId: string | null }
 | { kind: 'pick_bowler'; allowed: string[]; blocked: { id: string; reason: 'consecutive'|'quota'|'subbed_out' }[]; suggestedId: string | null }
 | { kind: 'record_ball'; freeHit: boolean }
 | { kind: 'resume' } | { kind: 'start_super_over' } | { kind: 'finish'; result: DerivedResult }
 | { kind: 'ask_style'; registrationId: string; what: 'battingHand'|'bowlingStyle' }
 | { kind: 'retire_prompt'; registrationId: string; atRuns: number }
```

Rules for the suggestions:
- `suggestedId` for a batter: the next in `battingOrder` who is not out, not batting and not subbed out.
- `suggestedId` for a bowler: the allowed bowler who bowled least recently. Ties go to the fewest overs.
- `ask_style` is emitted once per player per match when the style is unknown and the player starts batting or bowling.

### S-5 `PublicLiveState`

What viewers get. It must serialise below 6 KB for a T20.

```ts
interface PublicLiveState {
  v: 1; seq: number; phase: Phase; updatedAt: string; lastBallAt: string | null;
  teams: { home: TeamRef; away: TeamRef }; tossLine: string | null; conditionsLine: string;   // "Night · white leather · turf"
  innings: { battingTeamId: string; runs; wickets; overs: string /* "14.3" */; target: number | null; superOver: boolean }[];
  situation: string;                // "Royals need 43 off 33 balls" | "Strikers 154/8 (20)" | "Play stopped: rain"
  batters: { id; name; initials; photoUrl: string | null; runs; balls; fours; sixes; onStrike: boolean; hand: 'right'|'left'|null }[];
  bowler: { id; name; style: string | null; figures: string /* "2.3-0-17-1" */ } | null;
  thisOver: string[];               // ["1","4","Wd","•"]
  recent: { seq; over: string; text: string }[];   // last 12 commentary lines (C-6)
  batterShots: Record<string, { angle: number; runs: number }[]>;   // current batters only
  ballsLeft: number | null; requiredRate: string | null; currentRate: string;
  result: string | null;            // "Royals won by 6 wickets"
  trust: 'verified'|'confirmed'|'self_scored'|'flagged';
}
```

### S-6 `PlayerLine`

```ts
interface PlayerLine {
  registrationId; teamId; appeared: true;
  batting?: { runs; balls; fours; sixes; out: boolean; howOut: string | null; position: number; notOut: boolean; retiredHurt: boolean };
  bowling?: { legalBalls; maiden: number; runs; wickets; dots; wides; noBalls };
  fielding?: { catches; stumpings; runOutsDirect; runOutsAssisted };
}
```

Super-over balls are excluded from `PlayerLine` (R-21).

### C-6 Commentary

`commentary.ts` exports `commentaryLine(ball: BallSummary, names: NameBook, lang: 'en'|'hi'): string`. The English templates are fixed below; Hindi equivalents use the same structure.

- `"{over} {bowler} to {batter}, {result}."`
- result:
  - `no run`
  - `1 run` / `{n} runs`
  - `FOUR` / `SIX`
  - `wide` / `{n} wides`
  - `no ball` (+ ` and {n}`)
  - `{n} bye(s)` / `{n} leg bye(s)`
  - wicket: `OUT, {howOut}`
- With a shot zone: append ` to {zone label}`.

---

## N · Results and NRR

- **N-1 `deriveResult`** returns null or one of:
  - `{ outcome: 'home_win'|'away_win'|'tie'|'no_result'|'abandoned'; winnerTeamId: string|null; marginText: string; method: 'super_over'|'dls'|'manual_target'|'walkover'|null }`.
  - `marginText` reads e.g. "by 6 wickets", "by 22 runs", "on super over", "by walkover".
- **N-2** `fixture_results.score` written at finalize: `{ home: { runs, wickets, balls, nrr_runs, nrr_balls }, away: { … } }`. *(Amended 2026-10-14 to follow the ICC playing conditions; the original text charged every revised chase its full quota, which was wrong.)*
  - `runs` / `balls` = actual runs and legal balls (display).
  - `nrr_balls`:
    - all out **or no batter left to come in** (`no_more_batters`), with `allOutUsesQuota`: the innings quota (`maxBalls`, the revised one if revised);
    - otherwise the legal balls faced. A winning chase, revised or not, is charged only the balls it faced.
  - `nrr_runs`: the runs counted for NRR. Equal to `runs`, except in a match with a revised target (manual or DLS): the side that batted first is credited with **target − 1 runs off the chasing side's allotted balls** (`nrr_runs = target − 1`, `nrr_balls = chase maxBalls`).
  - Super overs are excluded.
- **N-3** `packages/core/src/standings.ts` changes:
  - `StandingsRules` gains `allOutUsesQuota?: boolean` and `excludeNoResultFromNrr?: boolean`.
  - When `excludeNoResultFromNrr` is set, `no_result` outcomes do not add scores (points are still awarded).
  - The cricket tiebreaker uses `netRate("nrr_runs" if present else "runs", "nrr_balls" if present else "balls", 6, …)` (the `preferredNumerator` option). Implement as a new helper `netRateWithFallback(numerator, preferred, fallback, per, label, options)` in `tiebreakers.ts`, and use it in the cricket and box_cricket packs. This is still a value call, so `pack-contract` stays green.
  - The display `summariseSide` keeps using `balls`.
- **N-4** `server/competition/results.ts` `recordFixtureResult` refuses with the new reason `scored_match` when a `matches` row exists for the fixture with `last_seq > 0`. The UI shows "This match is scored ball by ball. Correct it from the scorecard."

---

## A · Awards (`packages/core/src/scoring/awards/`)

- **A-1** `cricket-v1` points table per format group:
  - `t20`/`odi` use the T20 column;
  - `t10`/`six_over`/`tennis_gully` use T10;
  - `box_6` uses Box.

  Values are exactly FINAL.md §7.3 (PLAN §7.3 table). `matchRunsPerBall` = total runs ÷ total legal balls across the non-super-over innings.

  Two further rules:
  - **Milestones do not stack.** Only the highest reached milestone scores; 58 runs gets +8 for 50, not +4 and +8.
  - **Thresholds.** Pace and economy apply only above the minimum balls (T20: 10 balls batting, 12 balls bowling; T10: 6/6; Box: 5/6), and are capped (±10 / ±8 / ±6).
- **A-2** `AwardLine` is `{ code: string; label: string; qty: number; points: number }`. Codes:
  `runs, fours, sixes, milestone_30, milestone_50, milestone_100, milestone_25, milestone_20, pace_vs_match, wickets, bowled_lbw_bonus, top_order_bonus, haul, dots, maidens, economy_vs_match, catches, stumpings, run_out_direct, run_out_assist, duck`.
  Labels are fixed English strings, e.g. `"Faster than the match"` and `"Cheaper than the match"`.
- **A-3** Award kinds:
  - match: `player_of_match`, `fighter_of_match`;
  - season: `season_mvp`, `best_batter`, `best_bowler`, `best_fielder`, `best_keeper`, `emerging`, `scorer_of_season`.
- **A-4** `pickMatchAwards(lines, result)`:
  - PoM = the highest points. If that player's team lost and a winning-team player is in the top 3, the highest winning-team player gets it instead.
  - Fighter = the highest player on the losing team, excluding PoM. Null on a tie or no result.
  - Tiebreaks: winning side → the larger of batting or bowling points → lower registration id (deterministic).
- **A-5** Season awards:
  - eligibility: verified/confirmed matches only (T-3);
  - MVP needs ≥ 50% of the team's completed matches;
  - qualification thresholds are PLAN.md §7.4;
  - tiebreak chains are exactly §7.4.

---

## API · Route handlers (all under `apps/web/src/app/api/score/`)

All are `export const dynamic = "force-dynamic"` and `runtime = "nodejs"`. Auth uses `currentSession()` from `server/auth/actions` (precedent: `app/api/media/upload/route.ts:51`). Responses are JSON. Errors are `{ error: RejectReason | 'forbidden' | 'not_found' | 'rate_limited', message: string }`.

- **API-1 `POST /api/score/[fixtureId]/events`.** Body: `{ deviceId: string; attempt: number; events: ClientEvent[] /* 1..50 */ }`.
  1. Load `matches` `FOR UPDATE`, inside `withTenantDb`.
  2. Authority (AUTH-1).
  3. Claim (C-claim): the caller must hold it, or the claim is empty and the first event is `match_started`.
  4. Rate limit: ≤ 300 events per minute per fixture, counted on `match_events` `received_at` (DB-counted, like `presign-quota.ts`).
  5. For each event, in order:
     - dedupe with `INSERT … ON CONFLICT (fixture_id, event_id) DO NOTHING`;
     - when it's new, check `replayMatch(effective ∪ event)`;
     - assign `seq = last_seq + 1`.
  6. Update `matches.last_seq/phase/updated_at`.
  7. Upsert `match_live_state` with `publicLiveState`.
  8. On `finish`, run FIN-1.
  - Response: `{ acks: { eventId, seq | null, status: 'stored'|'duplicate'|'rejected', reason?, message? }[], lastSeq, phase }`.
  - Events after a rejected one in the same batch are **not** applied (`status:'rejected', reason:'bad_payload', message:'Skipped after an earlier refusal.'`).
  - Events with `type ∈ {void, amend}` after `matches.phase='finished'` are accepted only within `editWindowHours` of `finished_at`, and only from the scorer or the organiser. After `final`, only the organiser can send them, and they reopen FIN-1.
- **API-2 `POST /api/score/[fixtureId]/start`.** Body: `{ deviceId; formatKey; conditions; lineups: {teamId; battingOrder; captainId; keeperId; substitutes}[2] }`.
  - Creates the `matches` row, validating every registration id is an approved registration of that team.
  - Writes `fixture_lineups` (replace) via the existing `saveLineup`.
  - Takes the claim.
  - Moves the fixture `published → in_progress` (`fixtureTransition(...,'start')`). Draft or scheduled fixtures are refused with "Publish the match first".
  - Appends `match_started` + two `lineup_confirmed` as seq 1..3.
  - Idempotent on deviceId when the claim already belongs to the caller.
- **API-3 `GET /api/score/[fixtureId]/events?since=<seq>`.** Authorised scorers and organisers only. Returns `{ attempt, lastSeq, events: MatchEvent[] }` (max 2000) so a device can resume.
- **API-4 `POST /api/score/[fixtureId]/claim`.** Body `{ deviceId, mode: 'clean'|'force' }`.
  - `clean` succeeds when the claim is empty or held by the same person.
  - `force` requires organiser (`fixture.manage`) OR (an authorised scorer AND `now − max(received_at of holder's last event, scorer_claimed_at)` ≥ 120 s). **Force is always a human action; nothing expires automatically.**
  - Returns `{ ok, holder: { name } | null, lastSeq }`. Audits `match.claim.taken|forced`.
- **API-5 `POST /api/score/[fixtureId]/handover-token`.** The holder gets a signed single-use token (HMAC with env `SCORING_HANDOVER_SECRET`, 10 min TTL) for the QR code.
  - `POST /api/score/handover/redeem` with `{ token, deviceId }` takes the claim **cleanly** for the redeemer.
  - The redeemer must be signed in. A guest scorer signs in with phone OTP; there is no anonymous scoring (simplifies trust).
- **API-6 `POST /api/score/[fixtureId]/players`.** Body `{ teamId, name, phone? }`.
  - Creates a club-only person (`people.club_org_id = org`, no contact) plus an approved registration on the team.
  - If `phone` is given, it is stored only via the existing claim path later; v1 does not store it here.
  - Returns the `registrationId`. Then the client appends `player_added`.
- **API-7** Style propagation. On storing `style_set`, update `registrations.batting_style`/`bowling_style` for that registration **only when the column is null**, mapping `right → 'right_hand'`, `left → 'left_hand'`, and bowling style keys 1:1. Audit `registration.style_set_by_scorer`.
- **API-8** Jobs. Extend `app/api/jobs/messages/route.ts` `handle()` with `sweepScoring()` from `server/scoring/sweep.ts`, which:
  1. marks `finished` matches older than `editWindowHours` as `final`, running FIN-1 again if any correction landed;
  2. marks `live`/`interrupted` matches with no event for 6 h as `stalled`, and audits;
  3. queues `match.quiet` organiser notices for matches with no ball for 15 min while live (dedupe per match per 30 min).

  Each step is wrapped in `.catch(() => "failed")`.
- **API-9 `GET /api/live/[fixtureId]?t=<share_token>|s=<slug>`.** Public.
  - Reads `match_live_state` via `systemDb` after the gate (P-1).
  - Returns `PublicLiveState`. If `trust_level ∉ {verified}` and `publicDelaySeconds > 0`, it returns the state as of `now − delay` (store the last N=30 states in a ring inside `match_live_state.state.history` keyed by `updatedAt`; pick the newest ≤ cutoff).
  - Headers: `ETag: "<seq>"`, `Cache-Control: public, max-age=0, s-maxage=1, stale-while-revalidate=5`. Honour `If-None-Match` (304).
  - Rate limit: none in app (CDN/Caddy absorbs). Add a posture allowlist entry `by-design` with reason "public live read model after visibility/share-token gate".
- **API-10 `POST /api/live/[fixtureId]/view`.** Body `{ t?|s? }`. Increments a per-minute viewer bucket in memory per process and flushes `viewer_peak = greatest(...)` every 60 s. Used for trust (T-2). Returns 204.

### AUTH-1 Who may score (`server/scoring/authority.ts` `mayScore(db, personId, fixture)`)

True when any of:
- (a) `fixture.manage` on the competition (owner/staff);
- (b) an active `fixture:scorer` grant (scope `tournament`, scope_id = competition id);
- (c) an active `fixture_officials` row with role `scorer` and `person_id` = caller;
- (d) an active `team_managers` row for either side's team.

A match scored under (d) only can never be above `confirmed` (T-1).

### FIN-1 Finalize (`server/scoring/finalize.ts`)

Runs in one `withTenantDb` transaction:
1. `deriveResult`.
2. Upsert `fixture_results` with `source='scored'`, `score` (N-2), outcome, winner and method. Bypass N-4's refusal by calling an internal function `writeScoredResult` (not `recordFixtureResult`).
3. Fixture `in_progress → completed` if not already.
4. (C35+) Replace `match_player_lines` for the fixture.
5. (C35+) Append `match_awards` rows (auto) unless an organiser override exists for that kind.
6. (C42+) Replace `ball_facts`.
7. Audit `match.finalized`.
8. Then, outside the transaction: `revalidatePath` on `/seasons/[slug]/fixtures`, `/standings` and `/c/[slug]`, and queue notifications (M-1).

---

## URL · Routes and screens

| ID | Path | What |
|---|---|---|
| URL-1 | `/score` | Scorer home: today's matches the person may score + Quick match. Mockup "1 · Scorer home" |
| URL-2 | `/score/[fixtureId]/setup` | Steps: conditions → XIs (order, C, WK, subs) → toss and openers. Mockups 2-4 |
| URL-3 | `/score/[fixtureId]` | The pad. Mockups 7-13 |
| URL-4 | `/score/shell` | Static, data-free pad shell for SW precache (offline cold start) |
| URL-5 | `/score/new` | Quick match (C40) |
| URL-6 | `/score/handover/[token]` | Handover redeem |
| URL-7 | `/c/[slug]/m/[fixtureNumber]` | Public live/result page, tabs Live · Scorecard · Charts · Squads. Mockups 14-18, states 21 |
| URL-8 | `/m/[shareToken]` | The same page for quick/private matches (noindex) |
| URL-9 | `/c/[slug]/m/[fixtureNumber]/opengraph-image` | Live score OG card. Mockup "LinkPreview" |
| URL-10 | `/seasons/[slug]/fixtures/today` | Organiser match-day board. Mockup "Match-day board" |
| URL-11 | `/c/[slug]/m/[fixtureNumber]/overlay` | Transparent 1920×1080 overlay (C43). Mockup "Stream overlay" |
| URL-12 | `/seasons/[slug]/posters/result/[fixtureId]` | Result poster route (posterResponse, kind `result`). Mockup "Result poster" |
| URL-13 | `/match/confirm/[token]` | Opposing manager confirmation. Mockup "Other captain confirms" |
| URL-14 | `/c/[slug]/p/[number]/insights` and `/me/insights` | Batter and bowler insights. Mockups 21-22 |
| URL-15 | `/seasons/[slug]/brief/[fixtureId]` | Captain brief (PRO). Mockup 23 |
| URL-16 | `/seasons/[slug]/awards` | Season awards and leaderboards. Mockup "Season awards" |
| URL-17 | `/join/[entryCode]` | Team entry for team-formation `team_entry` seasons (C41) |
| URL-18 | `/.well-known/assetlinks.json` | TWA (C45) |

Layout rule: `/score/**` uses its own minimal layout `app/score/layout.tsx` (no console shell). It imports only the theme bootstrap and fonts, and has a JS budget of ≤ 60 KB route JS over the framework baseline (check with `pnpm check:bundle`; extend its config with the `/score/[fixtureId]` route).

---

## P · Privacy and public gates

- **P-1** Public live access is allowed when either:
  - the competition visibility is `public` and the fixture status is `published|in_progress|completed`; or
  - the request carries the match's exact `share_token`.

  Otherwise 404 (indistinguishable from absent).
- **P-2** Public JSON and pages never include phone, email, DOB, `club_org_id` or registration status.
- **P-3** Betting delay applies per F-3 `publicDelaySeconds` to matches whose trust is not `verified`. The organiser can set 0 only for seasons where every match has an appointed scorer (UI hint).
- **P-4** Public scorecards are indexable (`index, follow`) only when competition visibility is `public`. Share-token pages are `noindex`.
- **P-5** Terms: add the paragraph "Live scores are for following matches. Using them for betting or resale is not allowed." to the existing terms page section that covers acceptable use (find it under `apps/web/src/content` or `app/legal`, and log the path).
- **P-6** Minors: a person is a minor when `registrations.date_of_birth` exists and age < 18 on the match date. Public outputs show `initials` instead of the full name, and no photo. Insights pages for minors are not public. Players with no DOB are treated as adults (consistent with current behaviour).

---

## T · Trust

- **T-1** `trust_level` rules, computed by `computeTrust(facts)` in `packages/core/src/scoring/trust.ts`:
  - `flagged` if any hard signal (T-2) is present and no organiser verification.
  - `verified` if the scorer authority was (a), (b) or (c) (AUTH-1) and the competition is not personal (`organizations.kind='club'`), or an organiser verified it.
  - `confirmed` if the opposing team's manager confirmed, or (`viewer_peak` ≥ 15 and the match was live-scored) and no dispute 48 h after finish.
  - else `self_scored`.
- **T-2** Signals (`TrustReason` codes):
  - **Hard:**
    - `pace_impossible`: ≥ 30 legal balls whose client timestamps span < 4 s per ball on average, **and** the batch was received live. A batch synced after the fact is judged as `backfilled`, not hard.
    - `same_person_both_sides`.
    - `overlapping_matches`: the same registration's person in two matches whose live windows overlap.
  - **Soft:**
    - `backfilled`;
    - `scorer_is_top_scorer` (the scorer's own registration scored ≥ 50% of team runs);
    - `opponent_all_guests` (the opposing XI has 0 people with phone or email).
- **T-3** Leaderboards, records and season awards count only `verified` and `confirmed` matches. Careers show all matches with a trust label (mockup Career).

---

## M · Notifications

New catalogue entries. Each needs a template and a label per INV-13.

| Key | Audience | Channels | Inbox key | Trigger |
|---|---|---|---|---|
| `match.result` | players of both XIs | in_app, email | `match.result_published` | FIN-1 |
| `match.award` | award winner | in_app, email, whatsapp (if opted in) | `match.award_won` | FIN-1 when PoM/Fighter is set |
| `match.confirm_request` | opposing team managers | in_app, email | `match.confirm_requested` | FIN-1 when the authority was only (d) |
| `match.quiet` | organiser | in_app | `match.quiet` | API-8 |

WhatsApp for `match.award` uses a **new** utility template key `da_match_award`. Register it in the DLT/WhatsApp template list exactly like `da_lineup_announced`, with the en + hi variants. If the founder has not approved it in Meta, the channel stays off via the existing switches (do not block).

---

## UI · Screen rules

- **UI-1** Mockups are the visual reference (canvas linked in FINAL.md, pages Scorer, Watch, Insights, Organiser + share, Both themes, Design language). Match layout, hierarchy, copy and component choice. Use existing components from `@desiauction/ui` (Button, Dialog, Tabs, PlayerPortrait, identity placeholder, RollingNumber) before writing new ones.
- **UI-2** Theme. All colours come from tokens: `var(--surface)`, `--surface-raised`, `--text-primary`, `--accent`, `--accent-ink`, `--border-subtle`, etc. from `packages/ui/src/generated/*.css`. New tokens, if any, are added to the token source used by the generator, never as raw CSS. Both `data-theme` values must pass the axe contrast checks (`e2e/axe.ts`).
- **UI-3** Allowed literal colours:
  - field `#112E1F` / `#0E281B` stripes;
  - pitch `#C9B48A`;
  - boundary rope `#E8EEF9`;
  - team colours from `teams.primary_color` / `seasonTeamColours`;
  - chart series via new tokens `--chart-s1` (floodlight `#4A90E8`, daylight `#2F6FC8`) and `--chart-s2` (floodlight `#C2861F`, daylight `#A86F12`), both validated.
- **UI-4** Test ids (stable, used by e2e and by the validator):

  | Area | Test ids |
  |---|---|
  | Pad | `pad`, `pad-score`, `pad-overs`, `pad-need`, `pad-run-0`..`pad-run-6`, `pad-run-more`, `pad-mod-wide`, `pad-mod-noball`, `pad-mod-bye`, `pad-mod-legbye`, `pad-wicket`, `pad-undo`, `pad-menu`, `pad-sync` (with `data-pending="<n>"`), `pad-offline-banner`, `pad-free-hit`, `pad-toast` |
  | Shot sheet | `shot-sheet`, `shot-zone-<zone>`, `shot-skip` |
  | Wicket sheet | `wicket-sheet`, `wicket-kind-<kind>`, `wicket-fielder-<registrationId>`, `wicket-pin`, `wicket-next-batter`, `wicket-confirm` |
  | Bowler sheet | `bowler-sheet`, `bowler-<registrationId>` (with `aria-disabled` + `data-reason`), `bowler-confirm` |
  | Style ask | `style-ask`, `style-<key>` |
  | Menu | `menu-interrupt`, `menu-revise`, `menu-penalty`, `menu-substitute`, `menu-no-result`, `menu-restart`, `menu-void`, `menu-theme` |
  | Finish | `finish-sheet`, `finish-confirm`, `finish-next-match` |
  | Handover | `handover-open`, `handover-qr`, `claim-force` |
  | Setup | `setup-conditions`, `cond-time-<v>`, `cond-ball-<v>`, `cond-ground-<v>`, `cond-pitch-<v>`, `setup-xi-<teamId>`, `toss-winner-<teamId>`, `toss-decision-<bat\|bowl>`, `setup-start` |
  | Live page | `live-score`, `live-situation`, `live-tab-<live\|scorecard\|charts\|squads>`, `live-updated`, `live-stale`, `live-follow`, `live-wagon` |
  | Result | `result-pom`, `result-fighter`, `result-share-poster` |
  | Match-day board | `today-row-<fixtureNumber>`, `today-action-<fixtureNumber>`, `today-problem-<kind>` |
  | Insights | `insights-wagon`, `insights-vs-type`, `insights-conditions`, `insights-sample` |

- **UI-5** Hindi strings for the pad live in `apps/web/src/app/score/[fixtureId]/strings.ts` as `{ en: {...}, hi: {...} }`. The pad language follows `people.language`. Keys:
  `wide, noBall, bye, legBye, wicket, undo, overDone, freeHit, tapRuns, nowRuns, whereDidItGo, skip, nextBowler, newBatter, finishMatch, offlineSaved, allSent`.
- **UI-6** Copy is fixed from the mockups. Notable strings:
  - "Open in Chrome to score";
  - "{n} balls safe on this phone";
  - "Reconnecting · score may be a few seconds old";
  - "The scorer has no signal";
  - "Where did it go?";
  - "Neel bats left-handed, so the field is flipped for you" (template: "{name} bats left-handed, so the field is flipped for you").
- **UI-7** Motion: respect `prefers-reduced-motion`. Run `pnpm check:motion` on new CSS. Text animations are transform-only (axe trap).

### Architect amendment · C06 correction history and attempt boundaries

`MatchState` has internal readonly `eventHistory: readonly MatchEvent[]` and `originalTieSetting: SeasonScoringRules["superOverTie"] | null`. Neither is public live state. Replay derives attempts from validated restart events, rather than the maximum supplied attempt. Restart clears scoring while preserving accepted raw history and the initial tie snapshot. An amendment may target an earlier amendment, resolving to its original ordinary event; the latest payload is validated against that original type. Void targets the original ordinary event and removes its amendment chain. Corrections cannot target restart, another void, a future/missing/cross-attempt/already-voided event, or change the tie snapshot. Final sequence/time metadata describes the raw accepted stream.

### Architect clarification · C07 style prompts

`ask_style` is a stable suggestion, one logical prompt per player and missing attribute. Pure `nextActions` calls never consume prompts. The scorer UI persists presentation/dismissal by `(fixtureId, registrationId, what)` across refresh and restart; known styles remove suggestions. Cross-device dismissal synchronization is outside this contract. The minimal English C-6 formatter is introduced in C07 for the public projection; Hindi and full snapshots remain C08.

### Architect amendment · C09 umpire-adjudicated over lengths

`innings_started` gains optional `miscountedOvers: Record<string, number>` containing explicit source declarations. Keys are canonical zero-based non-negative safe integers; counts are positive safe integers differing from `format.ballsPerOver`. `InningsState` stores a copied map plus `completedOvers` and `ballsInOver`. Actual `legalBalls` increments on each legal delivery, while official over completion occurs at that over's declared/default count. Strike rotation, bowler changes, delivery labels and maiden completion use official boundaries, never global actual-ball modulo.

`maxBalls` stays in normal format units. Its actual-delivery limit adds the declaration deltas for full scheduled overs and the final remainder; reject a final remainder exceeding its declared over length. Compute the conversion without allocating proportional to the limit. Innings exhaustion and public balls remaining use the converted limit. Bowling quota counts distinct official overs participated in, including shared overs; completion of an already-started over remains allowed. Statistics and bowler figures retain actual deliveries; public innings overs use `completedOvers.ballsInOver`. Run-rate and NRR definitions retain their explicit actual-delivery/quota inputs.

Import verifies every explicit declaration independently against raw delivery counts. Export preserves declarations and original official over groupings. Corrections refold the declaration and all counters, rejecting invalid subsequent events. Oracle assertion 3 uses declared/default counts for completed overs, with incomplete final overs permitted. Removing a necessary declaration must fail the oracle. Declared fully verified matches are passes, not skips; the full-run skip limit remains 0.5%.

### Architect amendment · C09 source extras, fielding and reconstruction

E-3 adds optional `extras.noBallRuns`, allowed only with `noBall:true`, a positive safe integer at least `format.noBallRuns`. It is the total no-ball extras for this delivery. Credit team and bowler with that amount; its surplus over the base contributes to physical-run parity and applicable run-out `runsCompleted`. Omission retains existing behavior. Run-out assistants may be distinct fielders up to fielding-side size; other dismissal types allow at most one fielder. `wicket.substituteFielderIds?: string[]` must be a distinct subset of `fielderIds` belonging to the registered fielding substitutes. These marked temporary fielders may field but cannot bat or bowl without a separate valid match substitution. Preserve source substitute markers and no-ball totals on export.

The importer precomputes its full reconstruction plan from source alone. After resolving explicit player entries, retirements and replacements, an exact reversal of the same two distinct crease players may produce one unconditional inferred `strike_swapped` before the next delivery. Audit each adjustment with innings/delivery, predicted/observed pair and preceding source delivery; reason `unrepresented_end_change`. Never derive adjustments from fold results or failed assertions. Assertion 2 checks conformance to this reconstructed sequence, including explicit inferred actions. Wrong ordinary rotation and over-end rotation must still fail mutation checks on adjusted and unadjusted segments; omitted/duplicated swaps fail. Unresolved identity changes and unexplained over lengths remain source-only exclusions. Curation chooses first eligible matches and publishes exclusions; every excluded match remains in the full-run denominator.

For D/L, a still-open first innings followed by another may receive a terminal `revise` at its independently verified official endpoint. A documented final chase target that would terminate recorded deliveries early may be applied terminally only if unrevised replay remains valid to the endpoint. This records effective adjudication without inventing interruption timing. Round-trip equality covers the supported imported cricket domain, retaining scoring fields and transitions; it excludes source-absent LS-1 metadata and raw event envelopes. Exports never embed hidden LS-1 state/history. This is not a lossless exporter for arbitrary native LS-1 matches.

### C09 explicit source availability and anonymous attribution amendment

`innings_started.absentBatterIds?: string[]` contains distinct registered batting-team players, excluding opening batters. Preserve as source `absent_hurt`; exclude from entry and suggestions, without wickets/statistics. Retired-hurt players are unavailable until explicitly resumed. Close `no_more_batters` only when crease and remaining eligible roster establish exhaustion, preserving last-man-standing behavior. `wicket.unknownFielderCount?: number` is a positive safe integer; known plus unknown fielders obey dismissal and side cardinality, and determines direct/assisted run-out credit. Unknown identities receive no individual statistics; export explicit unknown markers.

A first innings may receive terminal manual limit revision when its observed official endpoint exactly equals the following innings' explicit reduced target quota below the original limit, with exact actual-delivery conversion. Do not infer an interruption mechanism or arbitrary closure. Apply source match replacements before innings start when they determine opening participants.

C09 source normalization additionally permits explicit replacement effective position at the earlier of recorded position/first incoming batting or bowling participation, provided outgoing last participation is earlier. Audit both positions; temporary fielding does not qualify. Source-only endpoint planning may terminally revise an otherwise unnaturally ended innings followed by the opponent's innings, unless relevant deliveries are declared missing. Audit the observed endpoint; retain DLS only when explicit.

A recorded retired-hurt batter may explicitly resume the latest/current innings closed solely `no_more_batters` into an empty end. It cannot reopen after finish, an outcome override, a later innings, target/quota/wicket exhaustion. Anonymous substitute fielder identity normalizes to unknown count; anonymous substitute designation is excluded. Historical unresolved free-hit subtype/profile, incompatible raw bowling quota/consecutive overs, and cross-team registry ambiguity are explicit preflight categories, preserving the original denominator and 0.5% ceiling.

Astra's final C09 source-domain resolution deduplicates identical named fielder registry identities within one dismissal and derives direct/assisted classification from distinct participants. Explicit retirement batches expand into existing new-batter and retirement events without deliveries or balls faced. Incompatible wide-plus-batter runs, multiple delivery dismissals, unsupported non-delivery dismissals, explicit administrative Awarded outcomes and independently contradictory declared margins are source-only exclusions. Preserve all result assertions and the unchanged 0.5% ceiling.


## 2026-10-09 · C09 · User-approved acceptance amendment

The assistant proposed raising the C09 exclusion ceiling from 0.5% to 1.0%, retaining the same pinned 7,018-match corpus, documented source-only exclusions and zero execution failures. The user replied "keep going" and then "don't stop kepp going" after that concrete proposal and explicit acknowledgement. This authorizes the specified 1.0% ceiling and resolves the preceding threshold blocker. It does not waive failures, modify the corpus, or permit skipping later steps. Resume at C09; implementation remains uncommitted until the end, with no PR/push/merge. Earlier stop records and their original thresholds remain historical.

### C09 effective competition profile and remaining source cases

Astra authorizes optional `match_started.competition?: {name:string;season:string}` with non-empty strings. State copies this snapshot, preserves it across restart, and rejects conflicting restart or correction metadata under the same immutability policy as the tie setting. Export maps to standard `info.event.name`/`info.season`; numeric seasons normalize to strings. Canonical round-trip includes competition and tie setting. Select the documented IPL 2014 `boundary_count` profile from competition/season before examining outcomes; do not extend to other seasons without evidence. Official contemporary report: https://www.iplt20.com/news/article/around-the-ipl-week-3 . Winner derives independently from scoring boundaries.

Source-only predicates classify missing effective DLS targets, ordinary deliveries after target attainment, declared chase wins below target, unexplained final-innings termination and extra batter participation without an explicit replacement. Include penalties, retirements, availability and quota evidence; never invent missing events or targets from result margins. An otherwise active roster member marked as substitute remains ordinarily eligible; audit that marker normalization. Genuine external temporary fielders retain explicit substitute attribution.

For an otherwise valid registered injury/concussion substitution, the same shared provisional-reopening guard used by retired-hurt resumption may reopen the latest/current batting innings closed solely `no_more_batters`. The outgoing player must be recorded retired hurt, not dismissed; the incoming player must be eligible and unused. Reject reopening after any later innings, finish/outcome override, target/quota/wicket exhaustion, or for other substitution kinds. Preserve existing crease/scoring; an explicit following new-batter event enters the substitute. Source `1411261` has the represented concussion replacement and remains in the passing corpus.

### C10 denominator aggregation clarification (Astra)

N-2 applies `allOutUsesQuota` when producing each fixture's recorded denominator; standings cannot distinguish that adjustment from a revised-target denominator and must honor supplied `nrr_balls` even with the flag absent/false. Apply `nrr_balls ?? balls ?? 0` per included fixture and side before aggregation, preserving explicit zero. Keep actual balls independently for display. A lazy NRR aggregate backfills previous actual balls when its first explicit denominator arrives, separately for scored/conceded sides; all-legacy aggregate shapes may remain unchanged. No-result score exclusion retains counts and points. C10's all-out flag test exercises N-2 result production followed by standings, rather than suppressing a recorded denominator.


### C11 architectural clarifications (2026-10-09)

Astra resolved the award contract gaps after C10 passed. Run-out assist points apply only to exactly two distinct participants, including anonymous participants in the count. Three or more retain statistical credit but receive no assist points; derive eligible counts from effective non-super-over dismissals. `scoreMatch` retains its specified return shape; `pickMatchAwards` accepts candidates joined with registration ID, team ID, points and award lines, and nullable DerivedResult. Use award codes for discipline totals, deterministic ranking before the top-three winning-side rule, and no awards before a result.

A-5 references PLAN.md §7.4 (FINAL.md has no such table). Qualification applies to individual metrics, not primary runs/wickets eligibility: qualified metrics sort before unqualified, two unqualified metrics proceed to the next criterion. Undefined denominators are unavailable. Preserve qualification status and remaining counts; thresholds are 60 batting balls, 60 bowling balls for T20/ODI or 30 for short formats, and three relevant innings for averages. Registration ID is the final deterministic tiebreak. Emerging accepts caller-supplied organiser eligibility and ranks by MVP points without extending MVP's 50% participation threshold.

The previously unspecified scorer-of-season rule is explicitly added: highest caller-supplied count of distinct completed verified/confirmed fixtures scored, then lexical person ID; exclude zero counts. Scorers need not be registered players. All season performance totals filter to verified/confirmed completed fixtures.


### C12 architectural trust resolution (2026-10-09)

Astra authorizes the following explicit precedence, reconciling T-1, AUTH-1, FINAL §5 and A-C12-03. Hard signals without effective organiser verification are flagged. Effective organiser verification yields verified for clubs and confirmed for personal organisations. Backfilled or non-live scoring requires explicit opposing-manager confirmation without unresolved dispute (otherwise self_scored); scorer authority alone cannot upgrade it. For live scoring, club authority (a)/(b)/(c) yields verified. Otherwise opposing-manager confirmation without unresolved dispute yields confirmed immediately. The automatic route requires all of live scoring, viewer peak at least 15, a known finish at least 48 hours ago and no unresolved dispute. Otherwise self_scored.

Personal organisations never become verified (A-C12-03). Organiser verification is separate elevated evidence, so AUTH-1's team-manager cap applies to scorer authority alone. Execution T-1's combined viewers/live/48-hour route takes precedence over FINAL's separate automatic routes. FINAL's explicit-confirmation requirement for backfilled scoring is retained as an express amendment to T-1. Confirmation flags must be effective authoritative evidence for the applicable revision and account for later disputes; stale verification cannot override a new dispute. Reasons are retained regardless of upgrade, deduplicated in the named TRUST_REASON_ORDER.

`detectPace` accepts ordered {legal, clientRecordedAt, receivedAt} records, grouping identical receivedAt and inspecting legal deliveries only. A batch is live only if every timestamp is valid, nondecreasing in event order, and within [receipt minus LIVE_RECEIPT_WINDOW_MS=120000, receipt], inclusive, with no future tolerance. Otherwise emit soft backfilled (including timing that cannot prove live receipt). For at least 30 legal deliveries in a live batch, pace_impossible requires (last-first)/(count-1) strictly less than 4000 milliseconds. liveScored requires at least one legal delivery and every evaluated batch live. Empty input supplies no live proof.


### C13 configuration-boundary clarification (2026-10-09)

Astra authorizes optional APP_DATABASE_URL in apps/web/src/env.ts using the existing PostgreSQL-prefix validator, so the required schema regression uses the sanctioned environment boundary. Log an absent app URL through logger().info and skip role-only assertions only for absence. Invalid supplied configuration fails validation. Do not substitute the owner for app-role assertions or change serving pool selection. env.ts is explicitly included in C13's scope for this field.

### C16 · Astra automatic manager provisioning amendment

Automatic auction-owner provisioning is one-time per (org, competition, team, person). Any existing team_managers row for that tuple, including revoked rows of any source or role, suppresses sync. Explicit authorised later regrant remains valid; historical revocation does not override other AUTH-1 arms. Sync locks each tuple in stable order using transaction-scoped advisory key `ls1-manager:<org>:<competition>:<team>:<person>`, then rechecks source eligibility and all manager history in the insert statement; ON CONFLICT DO NOTHING remains. Future explicit manager grant/revoke paths must take the same tuple lock and recheck eligibility. C16 defines/tests the helper; C17 wires API-2 and C23 wires first scoring-page load because auction completion is engine-owned. rolesOf stays read-only. No engine change or premature UI.

### C18/C21 · Astra finish integration sequencing amendment

C18 implements API-1 through validated persistence and live-state updates, including legitimate finish events, canonical phase, finished_at and snapshot/history in one tenant transaction. Correction authorization and organiser-only corrections after persisted final are C18 obligations. FIN-1/API-1 step 8 is owned by C21: no placeholder finalizer, premature fixture completion/result publication or finalization notification at C18. A-C18-01..08 may pass with their listed behaviors/gates; API-1 finalization remains explicitly incomplete until C21.

C21 must also modify append.ts: newly accepted finish invokes FIN-1 steps 1–3 and 7 within the append transaction; accepted finished/final corrections refresh the result from corrected replay. Step 8 revalidation/notification follows commit. Duplicates/retries must not duplicate finalization audit or notifications. Tests must call append, including a finalization failure proving no acknowledged finish survives without its atomic result update.

### C18 · Astra public identity and historical age clarification

Known minors on the match date always show initials and no public photo, regardless of consent/adult confirmation; this supersedes INV-11's minor-consent exception. Missing/unusable DOB retains normal shownName treatment, but photos require consent and adult confirmation made on/before the match calendar date. Known adults use publicPhotoUrl with matching shownPhotoKey/shownPhotoConsentAt. Never substitute !isMinor or expose DOB/confirmation metadata.

Resolve age date from fixture.kickoffAt's calendar portion without local-time parsing; otherwise convert persisted matches.startedAt to the Asia/Kolkata calendar date. Use UTC midnight for existing UTC age helpers. Never current read time/client time. Missing both sources is a projection error. The stored date source must stay stable after start; preserve it before permitting any scheduling edit that can change it. Tests cover eighteenth birthday, Kolkata midnight fallback, consented minors and unknown-DOB photos.

### C18 · Astra append-only deduplication ordering amendment

After the match row lock, authority/claim/attempt/limit checks, look up fixture/event ID and acknowledge an existing row as duplicate without consuming sequence. For a new ID, replay accepted history plus candidate before inserting. A refusal inserts nothing and skips later batch entries. A valid candidate uses INSERT ON CONFLICT(fixture_id,event_id) DO NOTHING RETURNING seq, and state/history/sequence advance only after a returned insertion. All legitimate writers take the same match lock. An unexpected conflict may be a duplicate only with consistent authoritative history; otherwise abort/retry, never silently rebase. Earlier accepted batch entries may commit when a later candidate is refused. No deletion, exception recovery or per-event savepoint is used.

Fixture date stability audit: existing fixture-aggregate edit/reschedule SQL compares the read status and slot (unchangedSince); lifecycle updates compare status. C17's fixture lock plus in_progress transition therefore defeats stale scheduling writes. Astra confirms no extra date metadata, migration or fixture mutation changes are needed.

### C19 focused Astra amendment · guest handover and authority

The existing competition/resolve.ts may resolve a signed-in handover after canonical token/HMAC/attempt/TTL validation, by one exact fixture-ID read selecting orgId only. No new bypass file or system writes. Tenant transaction reloads all state. Redemption may atomically appoint a guest as fixtureOfficials scorer (createdBy issuer), transfer claim and audit redemption. Never revive removed officials. Audit officialId and inheritedAuthority; appointments delegated from effective arm d remain effective d through subsequent handovers, while independent stronger authority prevails. authority.ts is explicitly in this amendment's scope.

Exact base64url(fixtureId.attempt.expiry.HMAC) shape remains. Issuance audit match.claim.handover_issued binds tokenHash, attempt, issuer person/device and claim timestamp; never store token. Redemption requires issuance, same current claim tuple, current issuer authority, unexpired matching attempt and no match.claim.handover_redeemed tokenHash. All checks/writes serialize on match lock. Actual claim changes strictly advance scorerClaimedAt, including holder/device change-back; identical person/device claim preserves timestamp. Identical token reissuance reuses binding. Events do not invalidate. Successful handover authorizes different-person clean transfer; no automatic claim expiry.

### C20 focused Astra amendment · aggregate reuse

API-6 reuses exported addClubOnlyPlayer with optional audit source defaulting to organizer_manual; scorer_guest is used here. Validated name, empty role, null price band, optional phone ignored. Preserve duplicate-name refusal. AUTH-1 and fixture-side/same-season checks precede creation. Existing aggregate transition approve enforces tier ceiling under its lock and writes approval metadata/audit; assignTeam assigns the approved row. All writes atomic: controlled refusal must escape transaction and be translated outside; database constraint errors are never caught inside. Narrow internal notification option defaults to existing behavior, suppressed only for this contactless guest. Additional scope: registrations.ts, registration-aggregate.ts, append.ts. API-7 propagates only newly stored style_set in the append transaction, each column independently IS NULL, auditing actual changes; duplicates/rejections do nothing.

### C21 focused Astra amendment · FIN-1 notification sequencing

The prior C18/C21 sequencing paragraph's notification obligation is deferred to its owning commits: C36 registers/templates/labels and dispatches result/award with specified dedupe; C38 owns confirm_request and authority-d integration. C21 must perform real post-commit revalidation, atomic FIN-1 steps 1–3/7, append/finished-correction integration and retry/audit guarantees. No notification placeholder or unregistered send. C21 acceptance may pass with deferred dependencies recorded. Existing standingsOf in competition/results.ts is the standings implementation: read scoringRules, parseSeasonScoringRules and pass both flags into StandingsRules. Tests prove rollback prevents revalidation and successful finish/correction refreshes paths without duplicate effects.

### C22 focused Astra amendment · scheduled boundary and provenance

Authenticated sweep.ts may have one new by-design posture entry extending INV-05: system-pool discovery selects only candidate fixtureId/orgId. All detail reads/rechecks/mutations use withTenantDb. Existing SYSTEM_ACTOR owns job context/audits, never a people FK or synthetic account. Finalizer accepts separate recordedBy (human default unchanged); repairs derive responsible actor from latest accepted finish/correction for finished revision. Missing provenance fails that match. Compare corrections to persisted finalization revision and re-finalize only if behind; otherwise seal without rewrite or duplicate match.finalized. Terminal eligibility: non-null finishedAt, phase finished/walkover/no_result/abandoned, replay finished=true and derived result, elapsed edit window; exclude void. All checks under match lock; catch outside each tenant transaction and independently per API8 step; revalidate after successful commit. Narrow finalizer signature and posture entry/tests authorized.


### C23 amendment · API-6 before match creation (Astra, 2026-10-09)

URL-2's Add player operates before API-2 creates matches. API-6 locks fixtures FOR UPDATE, not a required matches row, inside its existing tenant transaction. Permit published/in_progress fixtures only; require current AUTH-1, fixture-side team and same org/season. Keep the C20 season guest advisory lock, aggregate approval/tier/assignment and rollback unchanged. API-6 creates no match, claim or events and never mutates persisted XI. The fixture lock serializes API-2/fixture mutations without adding a fixture→match lock dependency. C23 first-load manager sync handles lazy authority provisioning; API-6 does not grant authority. Setup awaits guest creation and includes its returned registration in local selection and API-2 lineup; no player_added before start. Regressions cover no-match published success and absence of match/claim/events, unauthorized/wrong-team inertness, both start/add orderings, duplicate/tier rollback and ineligible fixture states. Narrow guests.ts and regression edits belong to C23; later pad/queue scope stays in order.


### Architect amendment · C24 7–10 run stepper

E-3 runsBat accepts integers 0..10 inclusive, representing all selected runs off the bat. Eight to ten carries no boundary flag; boundary validation remains matching 4/6 only. E-4 runs_out_of_range message becomes “Runs must be between 0 and 10.” Supersede C02’s 8-rejected assertion with 11 rejected. Extras remain separate modifiers and total delivery runs may exceed ten. C24 narrowly updates core validation/messages and accounting/parity/replay/amend regressions, with G-core added to its existing gates.

### C25 focused architecture amendment — player styles and queued groups

C25's tenant read model carries validated battingHand, bowlingStyle and parsed season shotMap. Effective attributes use explicit match style first, then independently validated profile attributes, without silent canonical hydration. Known attributes suppress their ask_style only; dismissals persist per fixture, registration and attribute. User confirmations still append style_set through the existing API. Shot mirroring captures the recorded delivery's batter hand before strike rotation.

Local applyBatch validates the complete proposed group against successive local states before one publication and queue persistence. Persist group identity/order and keep groups indivisible across the 50-event request boundary, reload and retry; flush an earlier partial batch when necessary. Derive replacement selection after the wicket and omit new_batter when the innings closes or no replacement is required. This is one submitted batch, not server atomic acceptance: preserve an accepted ball after a rejected replacement, reconcile authoritative history and reopen replacement selection. Required regressions cover profile/match precedence, unknown/dismissed prompts, recorded-batter mirroring, group rollback/boundary/restore, partial server rejection and innings-ending wickets.

### C26 focused architecture amendment — whole-match void and restart

Add distinct `match_voided: {reason:string}` with null target, trimmed non-empty bounded reason, canonical event validation/API-1 allowlist and internal outcome `void`; ordinary event-level void remains unchanged. No migration: event type is unrestricted text and phase void exists. Preserve innings/history, set terminal finished/phase/outcome void, derive no result and no next actions. Permit this specific transition after finish/final, but raw replay forbids subsequent events including correction/restart, and forbids correction of match_voided itself.

API-1 requires actual fixture.manage and the current device claim (existing organiser force claim remains available). Whole-match void after finished/final has no scorer edit-window restriction. Under match lock atomically append, store phase void overriding final-phase preservation, update snapshot and audit match.voided with actor/reason/event ID/attempt/sequence. Preserve finish/finalization timestamps as history; receipt supplies void time. Do not run ordinary FIN-1, delete the stored result or manufacture no-result. Authoritative result reads/standings exclude voided fixtures, including played/owed counts. Revalidate after commit. Future career/line/award/board commits apply the same exclusion. Cancel an unfinished fixture only through the existing permitted lifecycle transition; completed remains immutable/completed. Scorer home excludes voided matches.

C26 adds these core, append/finalization dispatch, result-read/standings and home changes plus G-core. Regressions: ordinary void unchanged; whole-match void before/after finish/final; organiser/claim/reason enforcement; deterministic replay/no resurrection; atomic fault rollback; duplicate audit inertness; retained raw results excluded from authoritative reads/standings.

Restart must first receive its acknowledgement, then submit match_started and accepted lineup confirmations via API-1 in the returned new attempt, preserving accepted setup, before fresh toss/openers. These are separate ordered requests because an API-1 batch carries one attempt; API-2's existing-match branch does not seed a restarted attempt. Do not increment twice or assume navigation recreates the match.


### 2026-10-09 · C26 · Astra existing-start lock resolution

Confirmed fixture→match API-2 versus match→fixture finalization/whole-void deadlock. Authorize removing only the existing-match lookup's FOR UPDATE from start.ts: it is read-only and preserves the holder, while its fixture lock continues to serialize initial creation, lifecycle and guest setup. API-1 enforces fresh attempt/claim after any stale start snapshot. Any future mutation in this existing-match branch needs a fresh locking design. C26 scope adds start.ts and coordinated real-transaction finish/void regressions, retaining simultaneous first-start and holder-refusal coverage. All C26 gates remain required.


### 2026-10-09 · C26 · Astra completed-match read resolution

Authorize scoringSetup to read completed fixtures only when an existing non-void scored match exists, preserving tenant/AUTH-1 checks. Load match before lifecycle predicate. Scorer-home discovery remains published/in_progress only; setup redirects non-not_started phases. Read access does not relax API-1 claim, correction windows, final organiser restriction or void authority. Regressions cover finished/final refresh, typed-only/void/unauthorised/cross-tenant exclusion, home exclusion and existing write restrictions. No lifecycle mutation or new endpoint.


### 2026-10-09 · C26 · Astra bundle repair

Authorize module-level next/dynamic imports for MenuSheet/EditBallSheet/FinishSheet/ReviseSheet only, erased type imports and eager fold/queue logic. Fresh build/full bundle check must preserve all ceilings; initial pad155.0KB passed but unchanged home151.1/151 and admin auction150.6/150 failed after chunk repartition. Visible loading, recoverable failed chunk, first-open/automatic finish/focus/both-theme checks required. C27 must cache these split build files for offline use. No budget increase or excluded route.


### 2026-10-09 · C26 · Astra setup dependency repair

Four-sheet lazy imports did not restore shared budgets (home151.2/151, admin150.6/150). Authorize server-side accepted setup reconstruction in authenticated tenant history read, passing only format/conditions/lineups/attempt/snapshot sequence, with explicit return-to-pad recovery for missing seed. Extract readHistory and shared refusal into queue-free helpers. Setup removes eager replay/effect and loads the existing scoringDevice helper on submission without new identity behavior. API-2 followed by fresh history still verifies attempt and actor clientSeq; changed restored attempt is refused, pending event IDs stable on retry. Scope setup page/flow, tenant helper, history/refusal imports/tests. Fresh build/full unchanged budgets and restart/initial setup/recovery/freshness checks required; no guarantee/waiver.


### 2026-10-09 · C26 · Astra compact sheet entry

After setup-boundary repair, exact gzip9 measure home150571/151000 passes; adminauction150029/150000 remains a real 29-byte failure, pad152.8KB passes. Authorize one C26-only lazy entry exporting the four existing sheet components, selected through module-level next/dynamic in Pad. Eager scoring/loading/error/focus preserved; loading all four together is accepted. Fresh full unchanged bundle guard plus four sheets/partial-seed/relevant gates decide success, no rounding/measurement waiver.

### C26 manager lock-order amendment

Astra confirms manager→match→fixture→manager cycle. API-2 must read preliminary fixture identity without locking, provision managers in existing sorted advisory-lock order, then acquire fixture FOR UPDATE and recheck identity/org/competition, current authority, sides and lifecycle. Identity disappearance/change aborts the transaction; never reuse preliminary context. Existing-match lookup remains nonlocking; initial creation remains fixture-serialized. Manager locks precede match or fixture locks; existing-match mutations use match→fixture. Require coordinated three-transaction regression with already-provisioned accepted owner plus retained uniqueness/revocation tests. C27 preparation provisions before resumeScoring match SHARE; later projection must be genuinely read-only, splitting provisioning from projection if necessary. No gate waiver.

### C27 offline preparation amendment

API-3 prepare=1 is allowed only with since=0 under existing signed-in tenant AUTH. Ordinary resume response stays unchanged. Prepared bootstrap includes only actor, privacy-filtered names/setup, language/share path and attempt/lastSeq snapshot. Publish complete paginated history and bootstrap atomically after proving continuity; restart preparation on attempt change, never overwrite unsent queue. API responses private/no-store and never SW cached. Exact valid fixture-pad URL network failures redirect to static data-free /score/shell#fixtureId; setup/handover/other navigations keep ordinary offline fallback; HTTP responses including errors remain network responses. Warm the complete immutable shell/C26 lazy-sheet dependency graph before declaring ready. No private HTML/RSC/API/photo caching. All logout/account-switch paths await ls1:* IDB/localStorage cleanup, stop writers and prevent other-tab stale repopulation. Actor-bound cache never grants server authority. Provision managers before match SHARE and split genuinely read-only setup projection for later calls. All fixed gates and targeted privacy/race/offline checks remain.

### C27 static-shell CSP resolution

Astra authorizes exact /score/shell full-document GET/HEAD exception in existing Node middleware: server-only fixed/manifest-derived build artifact helper caches by build ID, hashes exact executable inline contents and external scripts, adds matching external integrity attributes, and serves HTML with hash script-src plus strict-dynamic. Preserve all other CSP directives, enforcement/report-only setting, request ID/noindex/security headers. No nonce script policy on this response; normal RSC/other routes retain existing behavior. Missing/mismatched artifacts fail closed with scriptless unavailable response, never relaxed policy. Verify normal and standalone Docker artifact paths/copy/tracing. Same helper exposes build-specific validated immutable /_next/static/ asset graph (shell/eager app manifests, C26 options-entry react-loadable files, CSS/font dependencies) through prepare bootstrap or inert shell metadata, no new endpoint. Missing lazy entry fails preparation. Cache HTML together with matching response CSP. Production acceptance CSP_ENFORCE=1 covers cold offline hydration/theme/four lazy sheets, unchanged unrelated nonce policy and blocked injected unlisted script; shell contains no session data and unchanged build/bundle gates remain.

### C27 unstarted match-day preparation resolution

Astra authorizes prepare=1 only for authorised published fixtures without matches: events [], lastSeq0, attempt null, preparation:"unstarted", privacy-filtered names/minimal setup bootstrap. Ordinary API-3 unchanged; no match/claim/events created or fixture→match locks. Every eligible today's fixture must receive an explicit outcome: started+complete data/assets means offline scoring ready; unstarted prepared means names/setup cached only, offline shell says Connect to complete match setup without scoring controls; failed fixture retains explicit retry, never success. Cached unstarted data never seeds API-2 or invents attempt1 offline; reconnect uses current AUTH/setup. Required all-unstarted/mixed/independent-failure/privacy/offline-unstarted/replacement-after-start regressions remain.

C27 readiness clarification (Astra): preparation:"unstarted" also covers existing not_started matches and any accepted state still awaiting setup-only input (toss/opening innings absent). Preserve actual attempt/history/snapshot; only no-match case uses null/empty. Readiness follows whether the offline pad can resume accepted state, not match-row existence. Match SHARE then read-only projection retained; interrupted initial setup/restart seeding/full history and transition after online completion require regressions.

### C27 bundle/preload resolution

Astra authorizes classifying new /score/shell under existing163KB scorer-route ceiling while retaining <=60KB overhead above framework; no existing route ceiling changes. Shared logout wrapper stays lightweight and dynamically imports awaited cleanup at invocation, preserving inbox/scoring/cross-tab cleanup at every entry. Add matching computed external-script integrity to script preload links, preserving URL/cross-origin settings. Fresh full bundle/build, exact admin bytes, logout success/failure and enforced-CSP cold preload/hydration acceptance required, no waiver.

### C28 scorer journey sequencing amendment

Astra authorizes C28 fullT10 journey to assert existing accepted live-state projection updates because publicAPI/page arrive in C29/C30. This is projection coverage only; public viewer coverage is not yet implemented, owned by C30. C30 must extend the same journey with a second browser on the real public page, accepted-delivery score and terminal-result updates. No skipped tests or premature viewer work. Twenty overs means ten legal overs per innings; extras add deliveries, valid chase reaches target on final legal delivery. All C28/milestone gates and other acceptance remain required.

### C28 missing innings continuation repair

Astra authorizes Pad start_innings integration and small sheet/model in existing lazy options entry to make the fixed T10 journey possible. Current replay/queued state supplies action number/team and canonical lineups; distinct openers (core-permitted lone-batter exception), eligible opposing bowler, only matching pending superOver flag. No prior-innings dismissal/quota carryover/new fields/core/API. Recompute/refuse stale action, prevent double confirmation, canonical useMatch.apply persistence/offline/normal refusal/reachable action. Required UI chase after60legalballs and refresh/offline/stale/double/invalid/superover coverage. All gates/budgets remain unchanged.

### C42 tournament-move continuity amendment (Astra, 2026-10-10)

D8/0122 copies the complete current 0116 `platform_move_tournament` definition, retaining every prior update, security setting, authorization check, grant, audit and return field. Add planned `ball_facts`/`match_confirmations` updates and `UPDATE team_entries SET org_id = p_target_org WHERE competition_id = ANY (v_comps)`. All entry statuses move; identifiers, captain identity, players, review evidence and competition linkage remain unchanged. Real move posture tests prove submitted/approved/rejected movement, target reads, refusal for unrelated source-tenant personnel, retained captain-only reads, isolation of other competitions, existing refusals and atomic rollback. Do not edit historical migrations 0116 or 0120. No extra schema or privilege widening.

### C42 D14 primary-extra mapping (Astra, 2026-10-10)

`ball_facts` is an analytics projection, not a lossless team-score ledger. Map `extra_kind`/`extras` in priority order: wide/all wide runs; no_ball/no-ball runs only (`total - runsBat - byes - legByes`), including mixed byes; otherwise bye/bye runs; otherwise leg_bye/leg-bye runs; none/null and zero. Bowler concession is `SUM(runs_bat + CASE WHEN extra_kind IN ('wide','no_ball') THEN extras ELSE 0 END)`. Summing runs_bat and extras cannot reconstruct total team runs/extras; canonical innings/player projections retain those. No synthetic fact rows for omitted byes or penalties. Null fielder_id for multiple named/anonymous participants; caught_and_bowled credits the canonical bowler even with no named fielders. Complete fielding attribution remains in player lines. Styles snapshot at delivery time; unknown remains null. Prove mixed byes/leg-byes, variable no-ball awards, pure byes, wides, corrections and grouped concession reconciliation over the same innings scope; preserve T3/current trust, super-over scope, privacy and P3 checks.

### C42 focused Astra identity and dismissal amendment (2026-10-10)

D9 additive post0122 migration adds nullable computed_person_id/winner_person_id. Only season scorer_of_season may use these; its registration identity columns must be null. All other kinds have null person fields. Null picks valid. Player awards retain registration semantics; scorer overrides discriminate personId with same organizer authority/reason and actual eligible completed trusted scoring participation, count as score. Existing append-only/tenant/current ordering/move semantics remain.

A5 absent emerging eligibility selects no automatic emerging player; absent bestN uses all eligible matches. Server-controlled on-demand/finale inputs agree; optional organizer choices require durable competition-scoped evidence, never public query mutation.

Insight averages combine separately aggregated D14 delivery numerators with canonical non-super-over dismissal records once per fixture/innings/registration. Add dismissal-time seq/condition snapshots to canonical batter JSON at transition when absent; correction/replay regenerates. Include nonstriker runout, retired-out, timed-out/zero-delivery buckets; exclude hurt/not-out; no fabricated facts. Zero or historically unattributed dismissal denominators are unavailable. Retain identical current trust/privacy/delay/fixture/revision/innings gates and60ballsample rule. No joins multiplying dismissals across deliveries.

### C42 URL16 whole-match conditions interpretation (Astra, 2026-10-10)
All six leaderboard tabs select complete eligible matches only when each selected dimension is known and equal on every effective non-super-over delivery and recorded nondelivery dismissal. Mixed/partly unknown/no-observation matches are excluded from specific filters; all conditions retains them. Unselected dimensions do not affect inclusion. Recompute complete canonical points/lines/sixes, qualification and team participation denominators from exactly this set, retaining A1/A5/defaults. Control label Whole-match conditions; show selected count and help explaining mixed/unknown exclusion. Award cards, persisted picks/overrides/finale/scorer/emerging remain whole-season unfiltered; no filter reaches writer. Required homogeneous/mixed/unknown/unselected/corrected/nodelivery/sample/participation/original-points/persisted-invariance proofs; no waiver.

### C42 focused Astra amendment: canonical initial styles (2026-10-10)
API-2 validates selected registrations and reads recognized profile styles in the same start transaction, including nominated substitutes. After match_started and both lineup_confirmed events, append one existing style_set per registration with known fields, sorted by registration ID. Unknown/unrecognized fields remain absent. Replay the complete list before writing; use unique event IDs, contiguous server/client sequences, authenticated starter attribution and actual final lastSeq. Existing-start retries return stored state without reading profiles or reseeding. Start audit metadata records seeded IDs and registration-profile source; authority evidence includes all seeds. Do not emit profile-change audits for copying existing values; API-7 null-only propagation for later explicit changes is unchanged.
Restart copies styles from replayed prior attempt for registrations in newly seeded lineups, never current profiles, through the existing durable client batch. Navigate to fresh toss only after every expected seed is accepted. Reload/partial acknowledgement queues only missing seeds, preserving already accepted style changes. Later entrants and old matches use explicit style_set prompts before subsequent deliveries; current profile may prefill but never suppress the prompt. Canonical styles govern shot mirroring and delivery snapshots; existing unknown/dismissed semantics remain. Never backfill old history.
Required proofs: known/partial/unknown profiles; profile edits after start do not change earlier deliveries; idempotence and sequence continuation; restart partial acknowledgement/reload; later entrants and old unknown history; later changes/corrections; real >=60-ball browser hint. All gates and timing limits remain.

### C43 focused Astra overlay and brief amendment (2026-10-10)

Keep lean PublicLiveState unchanged. Each canonical stored ring entry adds closed overlay {seq,attempt,inningsNo,betweenOvers,lastDelivery}; lastDelivery {seq,boundary:4|6|null,dismissal:boolean,sting:four|six|wicket|null} derives from effective delivery, wicket first/no-ball boundary valid. Classification differing from original event suppresses sting. BetweenOvers requires live open started innings with actual canonical completed over and zero ballsInOver, including miscounts; not interruptions/waiting/terminal. API9 view=overlay returns {live,overlay,stat} from same delayed eligible ring entry; historical missing sidecar null, no current-history fallback. Ring30/P1/P3/currenttrust/void/privacy unchanged.
First load/reconnect baselines, no old celebration. Only new original delivery seq exceeding previously accepted snapshot seq triggers4s transform-only sting, no duplicate/amendment/rollback replay. Attempt/innings reset; stale/unavailable clears; newer qualifies replaces; reducedmotion honored; polling2s.
STAT uses selected snapshot on-strike registration, C42 knownstyle>=60facedsample from previously finalized matches excluding displayedfixture. Closed sanitized subject/style/rate/sample{balls,matches}; existing public scope/currentT3/minor/publication/delay gates apply, including private-token viewers (token grants no private careers). Unknown/minor/private/insufficient=>null. Render only betweenovers/no sting. Recompute boundedread and ETag digest of complete overlayrepresentation/currenttrust/STAT; access checks before304.
Brief requires signed-in fixture.manage organizer or active participating team_manager rechecked within existing tenant boundary, then tier pro|association; membership/sharetoken alone genericrefusal, authorizedfree lockedpreview with zero stats. Entitled uses same-tenant privateT3 aggregates with existing privacyhandling/no contacts/crossorg/public privilege. No newDBfields/dependencies/rawevents endpoint. Required delayedboundary/wicket, firstload/amendment/void/restart/duplicates,4s/reducedmotion,miscounts,59/60,unknown/minor/private,trust/privacyETag andbriefisolation proofs.

### C44 focused Astra connection amendment (2026-10-10)

Supersede C44's literal one-connection wording with at most two physical desiauction_system connections per live-service instance: one dedicated LISTEN connection and one max1 reader. Supported postgres APIs only. Listener-owning handle performs listen/lifecycle only, no ordinary queries; statement_timeout0 only listener config, existing30s reader timeout retained with bounded queue/work. No per-room pools/new dependency/schema/write grant/engine edits. Unsubscribe and close both owning handles on shutdown, replace connections without accumulating listeners/pools on reconnect. Prove committed versus rolledback pg_notify, actual backend cap, reader timeout, reconnect/no duplicatefanout and complete shutdown. All P1/P3/socket/origin/heartbeat/fallback/deployment/gates unchanged.

### C44 focused Astra full-browser gate repair (2026-10-10)

Authorize only the diagnosed minimum application-level repair in existing missing-route/not-found, shell or CSP integration plus focused regressions. Captured Flight tree already includes children/action catchalls and branded fallback; __next_error__ empty-body error recovery and matching nonces alone establish neither missing routing nor CSP defect. First reproduce unchanged fresh-context test with page errors, console/CSP violations, failed chunks and response timing. No speculative catchall/CSP edits. Preserve HTTP404, branded heading within original5s, nonce/strict-dynamic, both parallel branches and true client onward navigation with no new document navigation/500. No vendor/dependency upgrade, blanket middleware rewrite, forced reload, prewarm, retries or timing increases. Replace T10 global link count with separately scoped scoring/C43brief link assertions checking intended destinations; retain every delivery/correction/viewer/result/timing check. After repair focused fresh-context404/navigation, complete originalT10, freshbuild/unchangedbudget/full enforced-CSPbrowser and final-source C44 milestone gates required beforePASS.

### C44 focused Astra populated validation clock amendment (2026-10-10)

Existing auction-board regression may derive its logical NOW before any fixture insertion from max persisted auction_events.at_ms: max(Date.now(), maxExistingAtMs + HOUR + MIN), with null as no lower bound and safe finite integer validation. Retain every original relative timestamp/assertion and production global query/ten-row cap. Add actual >ten qualifying owned fixtures proving exact ten/newest-first/newest inclusion/oldest eligible exclusion, cleanup only owned fixtures. No process clock, unrelated record, production auction, engine, finops or settlement changes. Run populated isolated DB focused proof, full forcedintegration and all remaining C44milestonegates. Serial validation only; no claim of concurrent future-write isolation.

### C46 focused Astra empty-over accessibility amendment (2026-10-10)

Authorize only role="group" on existing .pad-over div, retaining aria-label="This over". It groups delivery-edit buttons and needs a valid accessible name even while empty. Preserve layout, button labels/disabled states/keyboard behavior; no added focus target/live region. Real empty/populated named-group axe in both themes, retained delivery names and actual editing, complete screenshot journey and final-source G-full without exclusions/timing changes required.


### 2026-10-10 · C46 · Astra UI4 and takeover completion amendment

Astra authorizes exact UI4 markers on actual existing regions/controls using canonical enum/registration/fixture keys; rename menu-handover to handover-open, handover-qr on actual image, retain distinct auxiliary sheet/accept markers. Native bowler disabled state remains authoritative with matching aria-disabled/canonical blocked reason (empty when enabled); repeated problem-kind markers scoped to fixture rows. Existing live-follow toss reminder meaning retained. No duplicate wrappers/aliases or layout/authority changes. claim-force is a real FINAL3/API4 completion gap: explicit online human takeover with confirmation, actual device, existing server timing/authorization only. Refetch canonical accepted history before scoring resumes; preserve saved pending deliveries and actor/attempt safeguards, no automatic conflicting replay/discard/reassignment. No new API/schema/privilege/expiry. Metadata and takeover proof separate; real early refusal/eligible takeover/organizer immediate takeover/old holder refusal/canonical resume plus marker inventory, keyboard/axe/screens, refreshed build/budget and G-full mandatory. Blocker log-only0f0afdbe retained. C46 resumed NOTPASS; no C47 advance. No PR/push/merge; implementation commits deferred.


### 2026-10-10 · C46 · Astra synthetic hub timestamp resolution

Astra authorizes test-only one canonical immutable live snapshot in bearer-isolation reader; exact unauthorized0/authorized1/shutdown1001 remain. Production full-frame dedup unchanged because fresh factory timestamps can legitimately create different same-seq frames. Add explicit timestamp and separate trust changes at same seq, each exactlyonce/no extra identical sends/no denied publication, deterministic held-read completion with fixedtimestamps/no longer sleeps/retries/relaxed counts. Focusedlive tests then full final-source G-full mandatory; blocker313da6dd retained. C46 resumedNOTPASS, noC47advance/PR/push/merge.


### 2026-10-10 · C47 · Astra compatibility and public panel amendment

Retain replayMatch(events) exactdeliverybehavior; add replayMatch(engine,events)/replayDelivery(events). FamilyEngine gains requiredreplay(events):S; delivery delegates established algorithm/internalimports unchanged, never naïveapplyreduce. PublicLiveState<P=unknown>, FamilyEngine publicstateusesP; FamilyAction currentclosedNextActionunion, futureextendonlyownsteps. Deliveryfamily/panel={v:1} is versionedcompatibilityenvelope, existingcricketfacts remainouter/no duplication/6KBunchanged. Onlyrealdeliveryregistered; engineFor(delivery)precise, otherfamiliesexplicitunsupported. Closedpanelprojectors reconstructallowedfields, failclosedunknownfamily/malformedpanel/trustedcompetitionmismatch. Persistedselecteddelayentry missingbothfields normalizesdeliveryonlytrustedactualdeliverycompetition, preservesseq/time/facts/no currentfallback. BothHTTP/WSsamechecks. API1/2/3 FIN1/liveproduction+reads resolve/useengine; delivery-onlysidecars/awards remainbranched. Unknownsportpackfallbackcannotgrantpermission; exactunsupportedstartmessage. Requireunchangedcricketrule/oracleassertions+replayerrors, legacy/explicit/alias parity correction/chainedamend/restart/wholevoid, registry/unsupportedstart, metadataonlyfixtureupdates, delayedlegacy/maliciouspanelstrip/mismatchbothtransports/6KB, allC47gates. Blocker93a7e8ff retained; C47resumedNOTPASS/noC48advance. NoPR/push/merge; implementationcommitsdeferred.


### 2026-10-10 · C47 · Astra canonical resume fixture amendment

Test-only repair authorized: store FORMAT_PRESETS.t20; event1 match_started with actual fixture teams and conditions timeOfDay=day; event2 conditions_changed timeOfDay=day_night; event3 conditions_changed timeOfDay=night. Preserve exact event envelopes, seq/clientseq, attempt, actor, receivedAt including n3 lastReceipt and all claim/handover assertions. Transition permits conditions_changed after start without XI/innings. Separate malformed fixture must prove whole-history refusal even when since excludes bad event, no partial events/no writes. Paging remains [2,3]/lastSeq3. Production canonical replay unchanged; strict actual sport identity in both public transports confirmed. Focused claim then all C47 gates required. Blocker0549c726 retained; resumed C47NOTPASS/noC48advance/PR/push/merge.


### 2026-10-10 · C48 · Astra rally boundary amendment

Authorize implemented-only discriminated delivery/rally pack formats and separate family payload maps. Preserve sealed delivery aliases/validators/wire/legacy replay. Registry adds real rally only; web requires delivery until scheduled C49, refuses rally through exact unsupported path, never casts rally state into cricket writers. Existing lineup_confirmed gains rally-specific {teamId,players:string[]} variant: both canonical squads required; nonempty unique disjoint IDs, rubber players members of own squad. C49 validates actual approved registrations, C48 validates accepted-history membership, no invented captain/keeper. Repeated rubber_started currentNo starts next internal game only after previous closed and rubber undecided, requires current active rosters/explicit firstServer. Next consecutive rubberNo only after rubber decided and fixture undecided. Refuse skipped/duplicate/reopening/post-result starts. Volleyball only substitute: active out/inactive own-squad in, same active count, open game or undecided between-game; active roster persists. No guessed quotas/rotation. Validate known preset identity/shape, volleyball exact identity sets/points, others rubbers/games; no custom/prefix/result-selector. Optional playerId active; ace/winner/kill/block winner-side, error/fault losing-side; no invented individual credit when absent, preserve real substitute participation. Effective correction/chainedamend/restart/terminalvoid replay with rawmetadata and closed public panel required. All RR cases plus continuation/refusal/substitution/cross-team/unknown/resultfields/replay/privacy/unchangedcricket and G-core/shared-type static checks required. Blocker19da1e77 retained; C48 resumedNOTPASS/noC49activation/gatewaiver/implementationcommit/PR/push/merge.


### 2026-10-10 · C49 · Astra shared rally execution/trust/awards amendment

Authorize discriminated family engine/state through start/append/resume/finalization/trust/snapshots/offline; original delivery logic unchanged, strict sport-specific preset, no rally-to-cricket casts. Approved same-team canonical squads; persist match_started and both rally lineup_confirmed before play; per-rubber future selections remain proposals/revalidate on rubber_started, not appearances. Rally trust uses effective current-attempt canonical rallies/original event IDs/client timing matched to stored receipts; amendments keep original activity timing. Reuse120second receipt validity/within-batch ordering; at least1effective rally and complete coverage for liveScored. No cricket30ball/4second physical threshold/no rally pace_impossible and no scorer_is_top_scorer from incomplete attribution. Applicable authority/dispute/confirmation/guest/sameperson/overlap remain; canonical participants incl real subs via selected engine. Overlap joins actual sport, strict own-engine replay/revision; unsupported/malformed no usable evidence, existing read-only boundary only. Finalize atomic/idempotent canonical result/pack fields/completion/trust/audit/postcommit. No rally match_player_lines, award points/autopicks/cricket ballfacts. Frozen marker unscored/rally/<formatKey>, reject cricket award calculations/overrides; core lines for participation/trust. Notifications derive rally recipients from canonical participants, no assumption scored rows. Hide unavailable award/career-point/cricket insights; honest match stats/result remain. No schema change. Volume opt-in only after delivered AudioVolumeUp/Down observed on AndroidChrome; discoverypress does not score, subsequent only opted-in and input-ready. Require correction/restart timing/participation/backfill without cricket pace/cross-family overlap/atomicfinish/nofabricatedrows/recipientcoverage/unchangedcricket plus allC49 gates/browser/boththemes. Blocker31f3e740 retained; C49 resumedNOTPASS/noC50advance/noPR/push/merge/deferredcommits.

### C49 focused loading-boundary amendment (Astra, 2026-10-10)

Authorize generic durable model/hook extraction with injected sealed family policies and separate concrete delivery/rally modules; selected pad/setup load boundaries; offline shell selects prepared family with loading/error states. Cache complete selected-family graph and required sheets before readiness; unavailable required assets fail preparation. Preserve synchronous ready scoring, durable ordering, claim/correction/recovery. Public rendering separates families while retaining selected delayed SSR scores/accessibility and stable polling/socket/sequence lifecycle. Shared primitive validators/lightweight known-format-key metadata may be extracted without validation weakening or copied preset definitions. Inspect emitted chunks; focused browser metadata/package exports allowed to remove unnecessary scoring code from unrelated routes, never auction semantics. No budget increase/default change/--write/excluded routes; scorer ≤60KB over framework remains binding. Only a separately evidenced unavoidable exact-byte metadata cause may receive a later bounded decision. Require import-graph/full-budget/SSR/enforced-CSP cold offline both-family/missing-assets preparation failure/durable claim and prescribed rally/cricket browser/gate proofs. Deferred chunks remain in asset evidence; initial-load checker alone insufficient.

### C50 canonical raid clock/mat/attribution amendment

Astra authorizes application semantics without external rule substitution. Pure replay validates finite, nondecreasing accepted clientRecordedAt timestamps (equal allowed), accumulated running milliseconds/anchor; half starts stopped, explicit clock toggles do not reset time, interrupt freezes/resume remains stopped. Effective amendments retain original target time and recompute subsequent clock; receipt time cannot advance it. Half time clamped; reaching expiry refuses raids/exposes explicit half_ended; no automatic event/point/result, explicit early half end allowed and recorded. Raid30s timer advisory running time since prior raid/first start, paused when clock paused, no invented timed offence/empty/out. Half1 first home, half2 first away; raids alternate. Raid lineup_confirmed={teamId,players,startingMat}: unique disjoint squads/exact7 distinct own starters, no invented sub/bench entry. Halftime retains mat/FIFO/cards/suspension remaining, resets empty streaks/half+raid clocks.

Pre-raid mat determines eligibility/bonus>=6/supertackle<=3. Active own raider/defender touched/tacklers; lineOut active defenders or raider, defensive lineout+1raid/raiderlineout+1defence. Reject duplicates/touch-lineout overlap/tackler-lineout overlap. Tackled requires >=1tackler/no touches/no raiderlineout; nottackled no tacklers. Bonus+tackle permitted at threshold. FailedDoD charges raiderout/defence1 only absent another raiderout charge. Any positive raid score resets empty streak, zero advances. KR03 every team point incl bonus/technical/allout revives eligible sporting outs FIFO. Primary tackler is explicit tacklerIds[0], receives tackle1or2 and supertacklecount; others assists/no duplicatedpoints; C51 deliberate primary choice. Raider gets touches/defensivelineouts/bonus; technical/allout/unassistedraiderlineout team-only.

Settle outs first then both base scores/FIFO; resulting zero-mat allouts once/team, opponent2team points and restore eligible sporting outs. Cards persist; no repeated card-depleted-empty allout, rearm only when mat nonempty; sameeventbonus no recursive awards. Literal green2game-minutes/yellow0/redmatch: yellow records/no persistent removal, green temporary/redpermanent eligibility removal, neither queued sportingout; suspended sportingouts retain FIFO but skipped until eligible/redneverrevives; expiry restores deterministically/no fakeevent. Extend implemented raid payload/action/state/PlayerLine/format/closed-panel unions/registry only, no webactivation beforeC51. Require KR01–08/exactclock/pause/interrupt/amendtime/early+expiredhalf/alternation/halftime/invalidoverlaps/bonus+tackle/primaryassist/FIFOcards/nonrecursiveallout/DoDdoublecharge/restartvoid/publicprivacy, unchanged delivery+rally, G-core/sharedstatic. No schema change/gatewaiver.

### C51 raid activation/trust/awards/clock presentation amendment

Astra authorizes typed raid activation through canonical setup/accepted approved squads and starting mats/durable queue/claim/append/replay/finalization/live privacy and existing notifications, no cricket casts/privileges. Freeze kabaddi-v1/<formatKey>, verify canonical own preset, persist actual raid PlayerLine/stats/points/explanatory lines, never cricket ballfacts. Exact C51 table. Raid discipline=raidpoints+superraid+Super10+DoD bonuses+tackled deduction; tackle discipline=tacklepoints+supertackle+High5 bonuses. Match rank totalpoints→winning side→max(raid,tackle disciplines)→registrationID. Preserve A4 top3 winning-player rule/losing Fighter excludingPoM; Fighter null withoutwinning side, PoM existing A4 includingplayednoresult/no candidatesnull. Teamtechnical/allout/assists no inventedpoints.

Add best_raider/best_defender; reuse season_mvp. Distinct completed nonvoid scored fixtures/current verified-confirmed only. MVP50% teammatch participation, totalawardpoints descending thenID; best raider positive raidpoints totaldescending thenID; bestdefender positive tacklepoints totaldescending thenID; noeligible=null/no cricket qualification. Durable bestN only MVP pointaccumulation/defaultall; denominators and raid/tackle totals all eligiblefixtures. Same pureselector on-demand/finale; overrides retain capability/reason/actualregistrationmembership/history/idempotence/computed-selected provenance; unsupported sport kinds refused.

Effective current-attempt raid originaleventID/time aftercorrection, fullstoredreceiptcoverage/atleast1raid and existing120sec receipt validity/ordering. Missingcoverage cannotprove live; knownlate/invalid suppliesbackfill. No cricketphysicalpace or scorertopscorer formula, preserve other trust/authority/confirmation/canonicalparticipant/strict actualsport overlap signals.

Closed validated canonical clockanchor from anchorAt plus elapsed/running/formatduration; never snapshotupdatedAt/correctionreceipt anchor. Publicdisplay extrapolates releasedtimeline=servertime minus applicableP3delay, consistently SSR/poll/WS context, client monotonicadvance from serverreference. Selected releasedsnapshot only/no privatecurrentclock. Clamphalf/raid; displayonly/no canonicalevent/points/revivals/closure/result; stop selectedpaused/interrupted/closed snapshot. Releasedcorrection mayresetdisplay; ticks never mutate seq/timestamps/ETag. Require arithmetic/discipline/tops3/null/positiveeligibility/bestN50%/duplicates/currenttrust/override/correctionrestart/noballfacts/delayedSSRhydration/pauseexpiry/amendclock/no fabricatedevents, C51browser/bundles/M11fullgates unchanged.

### C51 milestone public-load and setup-loading diagnosis amendment

Astra authorizes controlled causal diagnosis using preserved500viewer60second failure/same isolatedDB/productionartifact and unchanged profile/thresholds. Inspect process contention/CPU/eventloop/querywaits/connectionacquisition/JSON/HTTP/WS; distinguish diagnostics from acceptance and retain failures. Only demonstrated public-read/serialization/transport repair, or identified environmental contention removal; no speculative cache/pool expansion/timeout/preload advantage/exclusion/reduced concurrency. FreshP1/selectedP3/currenttrust/privacy/ETag/SSR/WS remain binding.

Existing authorized family setup boundaries may use shared accessible fallback: singlemain/Match setup heading/busy-status after existing gatechecks, replaced by real screen; no route-level loading aboveauth, nestedlandmark or fabricatedconditions. Screenshot capture may wait actual canonical marker/heading within originaltimeout before unchangedaxe/capture; prove transient loading accessibility separately, no delay/substitution. Ordinary empty-follow-up-batch, correct defending-turn bonus assertion and scoped tokenstyle repairs preserve canonical/servervalidation. Require focusedcausalproof/unchanged500-60s-300ms-80% load/loading+readyaxe/Kabaddi boththemes/all serialreferences/fullfinalgates/budgets.

### 2026-10-11 · C52 · Astra timed core contract

Timed lineup={teamId,players,startingActive,roles?}; unique disjoint squads/nonempty starting subset, rolekeys squadmembers/value existing sport vocabulary, absentrole unknown. Appearance at openedperiod activeentry/validsub, not squadselection; subactiveout/inactivenonredsamesquad, redreducescount/no replacement/quota/secondyellowfiction. Exactpresets football_90(2x45 running no shootout [1]), football_90_shootout(same true), hockey_60(4x15 stopped false[1]), hockey_60_shootout(same true), basketball_40(4x10 stopped false[1,2,3]); defaults regular/no futsalpack. Canonicalfinite/nondecreasing/equal timestamps/original correctiontargettime, nextconsecutiveperiod, runningpresetstartsclock/stoppedstartsfalse, explicitclockbothmodes/no reset, interruptfreeze/resumepaused, accumulatedrunningtime/clampperiod/sumgameClockMs. Expiryadvisory/explicitperiodend/earlyclosureallowed, scorewhileopenincludingpaused/expired, noautomaticresult/event.

Finaltiedshootouttrue startsimplicitly/homefirst/alternation; eligiblefinalactivenonred snapshot, everyeligibleplayerbeforecycle-repeat, best5earlycatchupclinch thenbalancedpairsudden-death, rejectwrongside/ineligible/prematurerepeat/resolved/periodclosedsubs; clockstopped/separateshootoutcounts/regulationgoalsonly/resultmethodpenalties+explicitmargin. No-shootoutfinaltie valid; basketball_40regulationtieexplicitly supported/no overtime/contradictorypackcomment corrected. Statsfrozenroles/actualappearances/activeintervals/actualattributedgoals-points/assists/owngoals/inplaypenaltysuccess/fouls/cards; shootoutattempt-conversionseparate. Optionalnormal scorer/assistactivesamecreditedteam/differentIDs; ownGoal scoreropponent/noassistorpenalty, flagsgoal-sportonly; missingattributionmissing/teamtotalcomplete. Basketballfoulownactiveteam; cardsactiveopenperiod/redremoves/green-yellowrecordonly. No penaltysave/miss inferredfromfailedshootout; preserveinterval/team-scoreevidence forlaterclean-sheetpolicy. C53awards/trust separate. Extendonlytimedunions/registry/closedpanels/coretests, no webactivationuntilC53. FullG-core/sharedstatic/nogatebudgetwaiver.

### 2026-10-11 · C53 · Astra timed web contract · resumed

Football freezes football-v1/<formatKey>; basketball basketball-lite-v1/<formatKey>. Actual frozen GK/DEF goals12 otherwise10, assists6, own-goals−4/yellow−1/red−5; scored penalty already goal. In-play penalty saves/misses remain explicitly untracked/no lines or shootout inference. Clean sheet once8GK/4DEF only explicitly completed regulation, actual canonical active interval appearance, known frozen role and zero conceded regulation goals across whole match; no minimum minutes, substitutions/red preserve appearance, shootouts excluded, abandoned/no-result excluded. Basketball actual points−fouls, no invented box statistics. Canonical scored lines/explanations, no cricket facts. A4 ranking total/winning preference/top3/Fighter excludingPoM then discipline football max(goal+assist awardpoints,clean-sheetpoints), basketball actualpoints beforedeductions, then registrationID; null/override authority/reason/membership/append-only/refinalization unchanged. Hockey frozen unscored/timed/<formatKey>, actual result/stats/recipients but no points/scoredrows/autoawards/overrides. Timed season awards unavailable.

Trust uses effective current-attempt period_started/period_ended/clock/interrupt/resume/score/card/sub/foul/shootout_attempt, original IDs/timestamps and void removal. Full original receipt coverage/120second/order validity; minimum effective score/shootout or positive canonical runningtime evidencedbyperiod/clock. Zero-goal genuine play supported; missing coverage never live, knownbackfill retained, no physicalpace/scorertop mapping; other signals unchanged. Typed setup/approvedsquad/active/frozenrole/append/replay/claim/offline/finalization/notifications/SSR/poll/WS reuse authorized. Released canonical anchor/elapsed plusserverminusP3, monotonicclampedperiod/game display, no privatecurrentstate lookup, correction/pause onlywhenreleased, no tickevents/results/ETagchanges. Required canonical/awards/frozenrole/clean-sheet/hockey/zerogoal/trust/correction/restart/recipient/privacy/offline proofs plusfootballshootoutboth-theme/basketballhockey/budgets/allC53gates. Blockere7c1fb86 retained; C53 resumed INPROGRESS NOTPASS, noC54advance.

### 2026-10-11 · C54 · Astra placement contract · resumed

Authorize distinct placement format key/label/rounds/frozen LobbyPoints, default1 explicit1–100 rounds, strict actual sport/server pack snapshot. match_started all scheduled teamIDs without home/away; lineup_confirmed actual approved same-team unique disjoint playing players. Each consecutive lobby_round1..configured has every team exactly once, placements1..teamCount/shared allowed, kills0..100, playerKills exactly playing roster including explicitzeroes/nonnegative integers/sumteamkills. Effective corrections/replay refuse broken laterrounds; allrounds derive result/explicitfinish, abandon no competitive result/topfrag/no walkover.

Aggregate roundpoints separately fromkills; overallcompetitionrank bytotalpointsDESC/killsDESC/sharedequalrank/teamIDdisplayonly. Add0124 nullable fixture_participants.source typed|scored, backfillexistingplacementtyped/unrecordednull; typedwritersets typed, scoredfinalizeaggregateplacement/kills/source atomically. Aggregatekillsmayexceed100 withoutlooseningtypedroundbounds. Scoredstandings replaycurrentfinalizedhistory/frozenrules anddistincttypedinput aggregatepoints/kills/placement, fixtureplayedonce/rankonewononce/sumeveryroundpoints. Malformed/missinghistoryfailclosed/no typedfallback; typedrefusesacceptedhistory; correctionrefinalizationrebuilds/void-abandonexcludes/nodata deletion. Existingparticipanttenantmovecoverage/proveaccess.

Ownplacementresult/publicvariants participantcollections/aggregaterows/nodummyduelfields, narrowfamilyconsumers/sharedgenuinelifecycle/claim/offlinepipeline. Closed sanitized public snapshots/currenttrust/P1/P3 acrossSSR/HTTP/WS/no rawhistory/privatecontact, cricketpayload/allroutebudgetsunchanged. Actualcumulativeplayerkills top_fragger rankkillsDESC/overallteamplacementASC/registrationIDASC, >=1kill otherwiseautoNULL, completeacceptedrosterappearance. Onlytop_fragger append-onlycomputed/overrideprovenance/auth/reason/membership/refinalization, noPoM/Fighter/season/genericpoints; canonicalstatsavailablewithoutmeaninglesszeroawardrows.

AuthorityA/B/Cunchanged;Dactivemanager scheduledteam/historicalactualrepresentedteam, multiplequalifyingteamsrequires explicitauthorizedselection. Revisionopponentconfirmation everyotherparticipatingteam viaitscurrentmanager;anyparticipantdisputeexistingprecedence, incompleteambiguoushistoricalsidecannot satisfyDarm. Live>=1effective round/full original receipts/120seconds+order/originalcorrectiontimes/restartclears, no physicalpace/scorertopsignal. Overlap/recipientsactualcanonicalallteams/strictengine/tenant. Requiredmultiroundnonfictionpoints/aggregatekills>100/typedbounds/sharedrank/attribution/correction/void/refinalize/source/moveRLS/allopponents/missinghistory/privacydelaytransportoffline/topfragtiemembershipnulloverride/battle-regression/scoredlobbygates plusmigration/roles. Blockerc6415622resolved; C54resumedINPROGRESS NOTPASS.
