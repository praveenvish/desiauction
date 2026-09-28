-- A PERSON'S DEVICES FOR PUSH NOTIFICATIONS (email programme PR18).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- Web push: a browser the person turned notifications on in hands us an
-- endpoint on its push service and two keys to encrypt to. One row per
-- browser. A push is the inbox notice delivered to the device — it follows
-- the person's Inbox switches, so it has no switch of its own.
--
-- Platform-to-person, like `consent_records` and `notification_preferences`:
-- no org column, no RLS; the module only ever reads and writes the session's
-- own person. An endpoint the push service says is gone (404/410) is deleted.
--
-- No new GRANT: `desiauction_app` holds ALTER DEFAULT PRIVILEGES in schema
-- public (ops/db/create-app-role.sql); verify-grants asserts it by name.

CREATE TABLE "push_subscriptions" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "person_id" char(26) NOT NULL REFERENCES "people" ("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" ("endpoint");
--> statement-breakpoint
CREATE INDEX "push_subscriptions_person_idx" ON "push_subscriptions" ("person_id");
