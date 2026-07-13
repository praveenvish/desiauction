CREATE TABLE "audit_log" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"actor" char(26) NOT NULL,
	"action" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" char(26) NOT NULL,
	"subject" text,
	"meta" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"person_id" char(26) NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" char(26) NOT NULL,
	"capability_set" text NOT NULL,
	"granted_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"capability_set" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" char(26) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" char(26),
	"accepted_at" timestamp with time zone,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" char(26) NOT NULL,
	"person_id" char(26) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_org_id_person_id_pk" PRIMARY KEY("org_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_inbox" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"person_id" char(26) NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"photo_consent_at" timestamp with time zone,
	"photo_consent_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"person_id" char(26) NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "audit_scope_idx" ON "audit_log" USING btree ("scope_type","scope_id","at");--> statement-breakpoint
CREATE INDEX "grants_person_idx" ON "grants" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "grants_scope_idx" ON "grants" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_idx" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "passkey_person_idx" ON "passkey_credentials" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "sessions_person_idx" ON "sessions" USING btree ("person_id");