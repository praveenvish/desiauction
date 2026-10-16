-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
-- Personal scoring spaces use the existing organization boundary, with one per owner.
ALTER TABLE "organizations" ADD COLUMN "kind" text NOT NULL DEFAULT 'club';
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_kind_check" CHECK ("kind" IN ('club','personal'));
--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_personal_owner_uq" ON "organizations" ("created_by") WHERE "kind" = 'personal';
