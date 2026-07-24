-- DA-04: a cricket team has exactly one captain.
--
-- `is_captain` was a free-form flag: nothing at write time, assignment time or
-- any later gate checked it, so two captains could sit on one team sheet and a
-- season could ship with none. The invariant belongs in the database, where it
-- cannot be forgotten by the next caller.
--
-- Demote first, then constrain — the index would refuse to build against the
-- rows that are already wrong. The earliest registration keeps the armband;
-- anything later is demoted and shows up in the migration's row count.

update registrations r
set is_captain = false
where r.is_captain
  and r.team_id is not null
  and r.id <> (
    select r2.id
    from registrations r2
    where r2.team_id = r.team_id
      and r2.is_captain
    order by r2.created_at asc, r2.id asc
    limit 1
  );
--> statement-breakpoint
create unique index "registrations_team_captain_uq"
  on "registrations" ("team_id")
  where "is_captain" and "team_id" is not null;
