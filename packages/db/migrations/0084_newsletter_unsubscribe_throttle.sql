-- A LIMIT ON THE TYPED UNSUBSCRIBE, AND THREE MORE TABLES THE SERVICE ROLES
-- NEVER NEEDED (go-live gate leftovers).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- 1. THE TYPED UNSUBSCRIBE HAD NO LIMIT.
--
-- /newsletter/unsubscribe still takes a typed address, on purpose: the list is
-- single opt-in, so proving the mailbox to LEAVE would make leaving harder than
-- joining (newsletter.ts says why in full). But joining is limited per network
-- address and leaving was not, so a script could empty the list one address at
-- a time. Every anonymous write here is throttled by counting its own rows per
-- address; a removal leaves no row of its own to count, so this is the row.
-- It records the network address and the time — never the email that was
-- removed — and the retention sweep deletes it after ninety days.
CREATE TABLE "newsletter_unsubscribes" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "request_ip" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "newsletter_unsubscribes_ip_idx"
  ON "newsletter_unsubscribes" ("request_ip", "created_at");--> statement-breakpoint

-- 2. THE ENGINE AND THE RUNNER, AGAIN.
--
-- 0083 took seven personal tables away from the two service credentials. Three
-- marketing tables were missed: the newsletter list (addresses and request
-- IPs), the demo requests (names, phones, emails) and the new table above.
-- Neither service names any of them (apps/engine, apps/finops-runner and the
-- packages they import, checked 2026-09-23). Guarded by role existence for
-- 0083's reason: on a fresh database the roles do not exist yet.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['desiauction_engine', 'desiauction_runner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON newsletter_subscribers, newsletter_unsubscribes, demo_requests FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
