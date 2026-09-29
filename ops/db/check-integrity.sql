-- DOES THE DATA ALREADY OBEY THE RULES WE WANT THE DATABASE TO ENFORCE?
--
--   docker compose exec -T db psql -U postgres -d desiauction -X -q \
--     -f - < ops/db/check-integrity.sql
--
-- READ-ONLY. It runs inside a transaction that is declared READ ONLY and rolled
-- back at the end, takes no lock stronger than the one a SELECT takes, and
-- changes nothing. Safe while an auction is running.
--
-- WHY IT EXISTS (PRR 2026-09-29). Two kinds of rule are still application
-- discipline only:
--
--   1. 29 foreign keys were added NOT VALID (migration 0069): new rows are
--      checked, the rows that were already there never were.
--   2. About two dozen relationship columns have no foreign key at all.
--
-- Turning either into an enforced constraint is one statement — and it
-- REFUSES THE DEPLOY if a single existing row breaks the rule. So the rows are
-- counted first, here, by hand. A line that says 0 is a constraint that can be
-- validated or added in the next migration. A line that says anything else is
-- a row somebody has to look at before anything is enforced.
\set ON_ERROR_STOP on
begin transaction read only;

\echo
\echo '== 1. Foreign keys that exist but were never validated (NOT VALID) =='
do $$
declare
  c record;
  child_cols text;
  parent_cols text;
  join_cond text;
  not_null text;
  broken bigint;
  total int := 0;
  bad int := 0;
begin
  for c in
    select con.oid, con.conname, con.conrelid::regclass as child,
           con.confrelid::regclass as parent, con.conkey, con.confkey,
           con.conrelid, con.confrelid
      from pg_constraint con
     where con.contype = 'f' and not con.convalidated
     order by con.conrelid::regclass::text, con.conname
  loop
    select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by k.ord),
           string_agg(format('c.%I is not null', ca.attname), ' and ' order by k.ord)
      into join_cond, not_null
      from unnest(c.conkey, c.confkey) with ordinality as k(child_att, parent_att, ord)
      join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = k.child_att
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.parent_att;
    execute format(
      'select count(*) from %s c where %s and not exists (select 1 from %s p where %s)',
      c.child, not_null, c.parent, join_cond
    ) into broken;
    total := total + 1;
    if broken > 0 then
      bad := bad + 1;
    end if;
    raise notice '% % rows break %.%', case when broken = 0 then '  ok  ' else '  FIX ' end,
      lpad(broken::text, 7), c.child, c.conname;
  end loop;
  raise notice '  -- % unvalidated foreign keys, % with rows that break them', total, bad;
end $$;

\echo
\echo '== 2. Relationship columns with NO foreign key: rows pointing at nothing =='
do $$
declare
  r record;
  broken bigint;
  bad int := 0;
begin
  for r in
    select * from (values
      ('auction_events',        'auction_id',     'auctions'),
      ('settlement_cases',      'auction_id',     'auctions'),
      ('settlement_cases',      'competition_id', 'competitions'),
      ('settlement_obligations','team_id',        'teams'),
      ('payments',              'team_id',        'teams'),
      ('journal_legs',          'posting_id',     'journal_postings'),
      ('journal_postings',      'case_id',        'settlement_cases'),
      ('paddle_grants',         'auction_id',     'auctions'),
      ('paddle_grants',         'team_id',        'teams'),
      ('auction_owner_invites', 'auction_id',     'auctions'),
      ('auction_owner_invites', 'team_id',        'teams'),
      ('fixtures',              'competition_id', 'competitions'),
      ('fixtures',              'home_team_id',   'teams'),
      ('fixtures',              'away_team_id',   'teams'),
      ('fixtures',              'ground_id',      'grounds'),
      ('fixture_results',       'fixture_id',     'fixtures'),
      ('grounds',               'venue_id',       'venues'),
      ('org_members',           'org_id',         'organizations'),
      ('invites',               'org_id',         'organizations'),
      ('competitions',          'tournament_id',  'tournaments'),
      ('teams',                 'franchise_id',   'franchises'),
      ('finops_documents',      'series_id',      'finops_series'),
      ('finops_period_days',    'period_id',      'finops_periods'),
      ('email_sends',           'org_id',         'organizations'),
      ('message_outbox',        'org_id',         'organizations')
    ) as t(child, col, parent)
  loop
    -- A table or column this database does not have is reported, not fatal:
    -- the list is written against the newest schema.
    if to_regclass(r.child) is null or to_regclass(r.parent) is null
       or not exists (select 1 from information_schema.columns
                       where table_name = r.child and column_name = r.col) then
      raise notice '  skip          %.% (not in this database)', r.child, r.col;
      continue;
    end if;
    -- Already constrained since this list was written? Then it is section 1's.
    if exists (
      select 1 from pg_constraint con
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
       where con.contype = 'f' and con.conrelid = to_regclass(r.child) and a.attname = r.col
    ) then
      raise notice '  has fk        %.%', r.child, r.col;
      continue;
    end if;
    execute format(
      'select count(*) from %I c where c.%I is not null and not exists (select 1 from %I p where p.id = c.%I)',
      r.child, r.col, r.parent, r.col
    ) into broken;
    if broken > 0 then
      bad := bad + 1;
    end if;
    raise notice '% % rows in %.% point at no %', case when broken = 0 then '  ok  ' else '  FIX ' end,
      lpad(broken::text, 7), r.child, r.col, r.parent;
  end loop;
  raise notice '  -- % columns hold rows that point at nothing', bad;
end $$;

\echo
\echo '== 3. A child row in one club pointing at a parent in ANOTHER =='
do $$
declare
  r record;
  broken bigint;
begin
  for r in
    select * from (values
      ('lots',          'auction_id',     'auctions'),
      ('bids',          'auction_id',     'auctions'),
      ('paddles',       'auction_id',     'auctions'),
      ('auction_events','auction_id',     'auctions'),
      ('registrations', 'competition_id', 'competitions'),
      ('teams',         'competition_id', 'competitions'),
      ('auctions',      'competition_id', 'competitions'),
      ('payments',      'case_id',        'settlement_cases')
    ) as t(child, col, parent)
  loop
    execute format(
      'select count(*) from %I c join %I p on p.id = c.%I where c.org_id <> p.org_id',
      r.child, r.parent, r.col
    ) into broken;
    raise notice '% % rows in % belong to a different club than their %', case when broken = 0 then '  ok  ' else '  FIX ' end,
      lpad(broken::text, 7), r.child, r.parent;
  end loop;
end $$;

\echo
\echo '== 4. Money that is negative, or sold lots that disagree with their bids =='
select 'payments with a negative amount'           as what, count(*) from payments
 where amount < 0 or captured < 0 or refunded_total < 0
union all
select 'payments refunded beyond what was captured', count(*) from payments
 where refunded_total > captured
union all
select 'journal legs with a negative amount',        count(*) from journal_legs where amount < 0
union all
select 'lots with more than one leading bid',        count(*) from (
  select lot_id from bids where status = 'accepted' group by lot_id having count(*) > 1) x
union all
-- A sold lot with bids must be sold to its winning bid, at that price. A sold
-- lot with NO bids and NO events was never auctioned: it was written straight
-- into the table (a seed, a fixture, a hand repair) and is counted apart.
select 'sold lots whose price is not their winning bid', count(*) from lots l
 where l.status = 'sold'
   and exists (select 1 from bids b where b.lot_id = l.id)
   and not exists (
   select 1 from bids b where b.lot_id = l.id and b.status = 'accepted'
      and b.amount = l.sold_price and b.paddle_id = l.sold_to_paddle_id)
union all
select 'sold lots that were never auctioned (no bid at all)', count(*) from lots l
 where l.status = 'sold' and not exists (select 1 from bids b where b.lot_id = l.id)
union all
select 'players sold in more than one lot of an auction', count(*) from (
  select auction_id, registration_id from lots where status = 'sold'
   group by 1, 2 having count(*) > 1) y
union all
select 'auctions whose event numbering has a gap',   count(*) from (
  select auction_id from auction_events group by auction_id
  having max(seq) <> count(*) or min(seq) <> 1) z;

rollback;
\echo
\echo 'Nothing was changed. Every line above should read ok / 0.'
\echo '("never auctioned" counts seeded rows: expected on a test database, 0 in production.)'
