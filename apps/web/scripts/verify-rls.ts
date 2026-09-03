// Runtime RLS verification (PRP-1 §1 quality gate). Proves, against live data,
// that the deployment's RLS posture is load-bearing:
//   1. the app role cannot bypass RLS (nosuperuser, nobypassrls);
//   2. every RLS table fails CLOSED outside a tenant boundary (zero rows);
//   3. inside withTenant the visible rows match the owner's count for that
//      org exactly — and a foreign org's rows stay invisible.
// Run: APP_DATABASE_URL=postgres://desiauction_app:...@host/db pnpm rls:verify
// (DATABASE_URL must carry the owner/bootstrap credential for reference counts.)
import { createDb, withTenant } from "@desiauction/db";

const ownerUrl = process.env["DATABASE_URL"];
const appUrl = process.env["APP_DATABASE_URL"];
if (ownerUrl === undefined || appUrl === undefined) {
  console.error("rls:verify needs DATABASE_URL (owner) and APP_DATABASE_URL (app role)");
  process.exit(2);
}

const owner = createDb(ownerUrl);
const app = createDb(appUrl);

let failures = 0;
function ok(message: string): void {
  console.log(`  ✓ ${message}`);
}
function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

async function main(): Promise<void> {
  console.log("RLS RUNTIME VERIFICATION\n");

  // 1 · the connection role must be unable to bypass RLS.
  const [role] = await app.sql<
    { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
  if (role === undefined || role.rolsuper || role.rolbypassrls) {
    fail(
      `app role ${role?.rolname ?? "?"} can bypass RLS (super=${String(role?.rolsuper)}, bypassrls=${String(role?.rolbypassrls)}) — verification is meaningless under this role`,
    );
    report();
    return;
  }
  ok(`connected as ${role.rolname} (nosuperuser, nobypassrls)`);

  // 2 · fail-closed: outside any tenant boundary every RLS table shows nothing.
  const rlsTables = await owner.sql<{ relname: string }[]>`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    order by c.relname`;
  console.log(
    `\nfail-closed proof (no tenant context) across ${String(rlsTables.length)} RLS tables:`,
  );
  for (const { relname } of rlsTables) {
    const [row] = await app.sql<
      { count: number }[]
    >`select count(*)::int as count from ${app.sql(relname)}`;
    const visible = row?.count ?? -1;
    if (visible === 0) {
      ok(`${relname}: 0 rows`);
    } else {
      fail(`${relname}: ${String(visible)} rows visible WITHOUT tenant context`);
    }
  }

  // 3 · load-bearing proof on live data: inside the boundary the tenant sees
  //     exactly the owner's count for their org; a foreign org stays at zero.
  const [subject] = await owner.sql<{ orgId: string; personId: string }[]>`
    select m.org_id as "orgId", m.person_id as "personId"
    from org_members m limit 1`;
  if (subject === undefined) {
    console.log("\nno organization data present — live-data proof skipped (seed first)");
  } else {
    const orgTables = await owner.sql<{ relname: string }[]>`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname
            and col.column_name = 'org_id')
      order by c.relname`;
    console.log(
      `\nload-bearing proof (org ${subject.orgId}) across ${String(orgTables.length)} org-scoped tables:`,
    );
    for (const { relname } of orgTables) {
      if (PARTICIPANT_SCOPED.has(relname)) {
        await participantProof(relname);
        continue;
      }
      const [expected] = await owner.sql<
        { count: number }[]
      >`select count(*)::int as count from ${owner.sql(relname)} where org_id = ${subject.orgId}`;
      const visible = await withTenant(
        app,
        { personId: subject.personId, orgId: subject.orgId },
        async (tx) => {
          const [row] = await tx<
            { count: number }[]
          >`select count(*)::int as count from ${tx(relname)} where org_id = ${subject.orgId}`;
          return row?.count ?? -1;
        },
      );
      if (visible === (expected?.count ?? -2)) {
        ok(`${relname}: ${String(visible)} rows visible in-boundary (matches owner)`);
      } else {
        fail(
          `${relname}: in-boundary sees ${String(visible)}, owner sees ${String(expected?.count ?? 0)}`,
        );
      }
    }

    const [foreign] = await owner.sql<{ id: string }[]>`
      select id from organizations where id <> ${subject.orgId} limit 1`;
    if (foreign !== undefined) {
      const crossTenant = await withTenant(
        app,
        { personId: subject.personId, orgId: subject.orgId },
        async (tx) => {
          const [row] = await tx<
            { count: number }[]
          >`select count(*)::int as count from org_members where org_id = ${foreign.id}`;
          return row?.count ?? -1;
        },
      );
      if (crossTenant === 0) {
        ok(`cross-tenant: org ${foreign.id} invisible from org ${subject.orgId}'s boundary`);
      } else {
        fail(`cross-tenant LEAK: ${String(crossTenant)} foreign org_members rows visible`);
      }
    }
  }

  report();
}

/**
 * PARTICIPANT-SCOPED TABLES (WR-1, migration 0041).
 *
 * A team owner's private plan carries the org floor AND a participant arm in
 * its policy: only a person holding a live paddle grant, a held paddle or an
 * accepted owner invite for THAT team of THAT auction sees the rows. So the
 * org-count equality above is the wrong proof here — a plain member is
 * supposed to see less than the owner. The right proof is the one below: a
 * participant sees exactly their team's rows, and a member of the same org who
 * does not participate in that team sees none.
 */
const PARTICIPANT_SCOPED = new Set(["auction_team_targets", "auction_team_target_revisions"]);

async function participantProof(relname: string): Promise<void> {
  const [sample] = await owner.sql<{ orgId: string; auctionId: string; teamId: string }[]>`
    select org_id as "orgId", auction_id as "auctionId", team_id as "teamId"
    from ${owner.sql(relname)} limit 1`;
  if (sample === undefined) {
    console.log(`  · ${relname}: no rows — participant proof skipped (add a plan first)`);
    return;
  }
  const [expected] = await owner.sql<{ count: number }[]>`
    select count(*)::int as count from ${owner.sql(relname)}
    where auction_id = ${sample.auctionId} and team_id = ${sample.teamId}`;
  const [participant] = await owner.sql<{ personId: string }[]>`
    select person_id as "personId" from paddle_grants
      where auction_id = ${sample.auctionId} and team_id = ${sample.teamId} and revoked_at is null
    union
    select person_id from paddles
      where auction_id = ${sample.auctionId} and team_id = ${sample.teamId} and released_at is null
    union
    select accepted_by from auction_owner_invites
      where auction_id = ${sample.auctionId} and team_id = ${sample.teamId}
        and accepted_by is not null and revoked_at is null
    limit 1`;
  if (participant === undefined) {
    fail(`${relname}: rows exist for a team with no participant — nobody can read them`);
    return;
  }
  const seenByParticipant = await withTenant(
    app,
    { personId: participant.personId, orgId: sample.orgId },
    async (tx) => {
      const [r] = await tx<{ count: number }[]>`
        select count(*)::int as count from ${tx(relname)}
        where auction_id = ${sample.auctionId} and team_id = ${sample.teamId}`;
      return r?.count ?? -1;
    },
  );
  if (seenByParticipant === (expected?.count ?? -2)) {
    ok(
      `${relname}: participant sees ${String(seenByParticipant)} rows of their team (matches owner)`,
    );
  } else {
    fail(
      `${relname}: participant sees ${String(seenByParticipant)}, owner sees ${String(expected?.count ?? 0)}`,
    );
  }

  const [bystander] = await owner.sql<{ personId: string }[]>`
    select m.person_id as "personId" from org_members m
    where m.org_id = ${sample.orgId}
      and not exists (select 1 from paddle_grants g where g.auction_id = ${sample.auctionId}
        and g.team_id = ${sample.teamId} and g.person_id = m.person_id and g.revoked_at is null)
      and not exists (select 1 from paddles p where p.auction_id = ${sample.auctionId}
        and p.team_id = ${sample.teamId} and p.person_id = m.person_id and p.released_at is null)
      and not exists (select 1 from auction_owner_invites i where i.auction_id = ${sample.auctionId}
        and i.team_id = ${sample.teamId} and i.accepted_by = m.person_id and i.revoked_at is null)
    limit 1`;
  if (bystander === undefined) {
    console.log(
      `  · ${relname}: every member of the org participates in that team — bystander proof skipped`,
    );
    return;
  }
  const seenByBystander = await withTenant(
    app,
    { personId: bystander.personId, orgId: sample.orgId },
    async (tx) => {
      const [r] = await tx<{ count: number }[]>`
        select count(*)::int as count from ${tx(relname)}`;
      return r?.count ?? -1;
    },
  );
  if (seenByBystander === 0) {
    ok(`${relname}: a same-org non-participant sees 0 rows`);
  } else {
    fail(
      `${relname}: PRIVACY LEAK — a same-org non-participant sees ${String(seenByBystander)} rows`,
    );
  }
}

function report(): void {
  console.log(
    failures === 0
      ? "\nRLS VERIFICATION PASSED — policies are load-bearing under this role."
      : `\nRLS VERIFICATION FAILED — ${String(failures)} check(s) failed.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void owner.sql.end();
    void app.sql.end();
  });
