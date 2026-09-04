-- A PERSON-SCOPED INDEX ON org_members (PRR P2/F36).
--
-- HAND-AUTHORED, like 0019–0034 (the drizzle snapshot chain is frozen at 0018).
--
-- org_members' primary key is (org_id, person_id). That composite serves "who is
-- in this org" — org_id is the leftmost column — but a lookup by person_id alone
-- ("which orgs is this person a member of") cannot use it and falls to a full
-- table scan. That lookup is on the hot path: the org switcher, every
-- person-scoped membership read, and the grants/authz resolution all ask it on
-- essentially every authenticated request. The `sessions` and
-- `email_verifications` tables already carry the equivalent person index; this
-- brings org_members in line.
--
-- ADDITIVE AND BACKWARDS COMPATIBLE. An index is pure acceleration: it changes
-- no row, no constraint and no lifecycle rule, so a rollback to the previous
-- build simply stops using it. No new GRANT — an index is not a table-level
-- privilege, and org_members' grants are unchanged (ops/db/create-app-role.sql).

CREATE INDEX "org_members_person_idx" ON "org_members" ("person_id");
