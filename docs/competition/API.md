# COMPETITION API REFERENCE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · **Permanent engineering asset** (IP-3, M-IP3-4)

> The Competition API is **Next.js server actions** (internal RPC, C-14 — public REST
> `/v1` remains deferred per the 0A ruling). Every action follows one gate: resolve
> session → resolve tenant (membership-gated; non-members are indistinguishable from
> missing) → require capability → call the aggregate/read model → audit. Errors return
> `{ ok: false, error }` with human copy; nothing throws across the wire. Sources:
> `apps/web/src/server/competition/actions.ts` (competitions + registrations) and
> `fixture-actions.ts` (venues + fixtures).

## Competitions & teams (`actions.ts`)

| Action | Capability | Behavior |
|---|---|---|
| `competitionsView()` | membership | Orgs + competitions across the caller's orgs |
| `createCompetitionAction(form)` | `competition.create` | Validated name (≥3), ULID-suffixed slug, audit `competition.created` |
| `competitionView(slug)` | membership (+viewer flags) | Competition + teams + triage list + `canManage/canReview` |
| `advanceCompetitionAction(slug, to)` | `competition.manage` | Core machine decides; setup→open guard (name+dates+location); audit `competition.status_changed` |
| `createTeamAction(slug, name, short, color)` | `team.manage` | Unique name per competition; audit `team.created` |

## Registrations (`actions.ts`)

| Action | Capability | Behavior |
|---|---|---|
| `registrationLanding(slug)` / `submitRegistrationAction` | any session | Submit while `registration_open`; duplicate (person, competition) refused; audit `registration.submitted` |
| `triageRegistrationAction(slug, id, action, reason?)` | `registration.review` | approve/reject(reason required)/waitlist/restore/withdraw via the Registration aggregate |
| `bulkTriageAction(slug, ids, action, reason?)` | `registration.review` | Core plans the batch (≡ N singles); one transaction; per-row audit; returns applied/skipped |
| `registrationDashboard(slug, params)` | membership (+`canReview`) | Server-driven stats, search/filter/sort, 25/page, duplicate-name flags |
| `registrationTimelineAction` / `addNoteAction` | `registration.review` | Audit timeline; append-only notes |
| `assignTeamAction(slug, id, teamId)` | `team.manage` | Pre-auction grouping (NOT squad membership); audited |
| `importPreviewAction` / `importCommitAction(slug, csv)` | `registration.review` | Core validates whole file; commit is one transaction; person stubs by phone; duplicates skipped |
| `exportRegistrationsAction(slug)` | `registration.review` | Deterministic competition-scoped CSV |

## Venues & grounds (`fixture-actions.ts`, org-scoped)

| Action | Capability | Behavior |
|---|---|---|
| `venuesView(orgSlug)` | membership (+`canManage`) | Venues with grounds, stable order |
| `createVenueAction(orgSlug, name, address, city)` | `venue.manage` | Unique name per org; audit `venue.created` |
| `createGroundAction(orgSlug, venueId, input)` | `venue.manage` | Surface/capacity/floodlights/indoor; unique name per venue; tenant-checks the venue; audit `ground.created` |
| `setGroundStatusAction(orgSlug, groundId, status)` | `venue.manage` | active/unavailable — unavailable grounds leave scheduling pickers; audit `ground.status_changed` |

## Fixtures (`fixture-actions.ts`, competition-scoped)

| Action | Capability | Behavior |
|---|---|---|
| `fixtureDashboard(slug, params)` | membership (+`canManage`) | Stats, conflicts (blocking+warning), filters (status/team/ground/number/sort), 25/page |
| `generateFixturesAction(slug, input)` | `fixture.manage` | Deterministic round robin → drafts; refused if live fixtures exist or blocking conflicts arise; audit `fixture.generated` |
| `createFixtureAction(slug, input)` | `fixture.manage` | Manual draft; teams must belong to the competition, ground to the org; audit `fixture.created` |
| `fixtureLifecycleAction(slug, id, action, reason?)` | `fixture.manage` | schedule/publish/start/complete/cancel via the Fixture aggregate — machine-decided, conflict-checked, audited |
| `editFixtureAction(slug, id, patch)` | `fixture.manage` | Draft+scheduled only (published requires reschedule); scheduled edits conflict-checked; audit `fixture.edited` |
| `rescheduleFixtureAction(slug, id, patch)` | `fixture.manage` | The published-move workflow; conflict-checked; audit `fixture.rescheduled` with old→new provenance |
| `scheduleAllAction` / `publishAllAction(slug)` | `fixture.manage` | Bulk ≡ N singles; returns applied/skipped |
| `fixtureTimelineAction(slug, id)` | `fixture.manage` | The fixture's audit trail |
| `calendarView(slug, {view, date})` | membership | day / week / timeline + upcoming, all server-driven |
| `matchDayView(slug, {date})` | membership (+`canManage`) | One date grouped by ground |
| `organizerScheduleView()` | membership | Upcoming fixtures across the caller's orgs |
| `fixtureImportPreviewAction` / `fixtureImportCommitAction(slug, csv)` | `fixture.manage` | Shape validated in core + names resolved against DB; ANY error refuses the whole file; atomic commit to drafts |
| `exportFixturesAction(slug)` | `fixture.manage` | `serializeScheduleCsv(scheduleSnapshot(...))` — a pure snapshot serialization |

## Read-model exports for future engines (not actions)

`scheduleSnapshot(db, competition)` → deep-frozen `ScheduleSnapshot` (see
[ADR-ScheduleSnapshot](ADRS.md)); `serializeScheduleCsv(snapshot)`;
`competitionFixtureSnapshots(db, competitionId)`. IP-4 consumes these server-side —
never the tables.

## CSV formats

- Registrations import: `name,phone,role[,base_price_band]` — E.164-normalized phones,
  in-file duplicate detection. Export: `registration_number,name,phone,role,status,team`.
- Fixtures import: `home_team,away_team[,kickoff][,ground][,duration_minutes]` —
  kickoff `YYYY-MM-DD HH:MM` or `YYYY-MM-DDTHH:MM`; duration default 180.
  Export: `fixture_number,round,home_team,away_team,kickoff,venue,ground,status,duration_minutes`.
