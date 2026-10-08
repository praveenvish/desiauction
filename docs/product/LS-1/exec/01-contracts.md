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
| `match_started` | `{ format: FormatSpec; conditions: Conditions; homeTeamId: string; awayTeamId: string }` |
| `lineup_confirmed` | `{ teamId; battingOrder: string[] /* ≥2, ≤ format.playersPerSide + 4 */; captainId: string; keeperId: string; substitutes: string[] }` |
| `toss` | `{ winnerTeamId: string; decision: 'bat' \| 'bowl' }` |
| `innings_started` | `{ inningsNo: 1\|2\|3\|4; battingTeamId; strikerId; nonStrikerId; bowlerId; superOver?: boolean }` |
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
  bowlerId: string; strikerId: string; nonStrikerId: string;
  runsBat: number;                       // 0..7, runs credited to the batter
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
| `runs_out_of_range` | "Runs must be between 0 and 7." |
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
- R-19: `super_over_started` creates two 1-over innings (`maxBalls` = `ballsPerOver`, `wicketsPerInnings` 2, `superOver` true). The team that batted second bats first.
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
- **N-2** `fixture_results.score` written at finalize: `{ home: { runs, wickets, balls, nrr_balls }, away: { … } }`.
  - `balls` = actual legal balls faced.
  - `nrr_balls`:
    - if all out and `allOutUsesQuota`, the full quota (`maxBalls` of that innings);
    - if a revised target applied, the revised `maxBalls`;
    - else the legal balls.
  - Super overs are excluded.
- **N-3** `packages/core/src/standings.ts` changes:
  - `StandingsRules` gains `allOutUsesQuota?: boolean` and `excludeNoResultFromNrr?: boolean`.
  - When `excludeNoResultFromNrr` is set, `no_result` outcomes do not add scores (points are still awarded).
  - The cricket tiebreaker uses `netRate("runs", "nrr_balls" if present else "balls", 6, …)`. Implement as a new helper `netRateWithFallback(numerator, preferred, fallback, per, label, options)` in `tiebreakers.ts`, and use it in the cricket and box_cricket packs. This is still a value call, so `pack-contract` stays green.
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
  - qualification thresholds are FINAL.md §7.4;
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
