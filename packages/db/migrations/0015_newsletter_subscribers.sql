CREATE TABLE "newsletter_subscribers" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email")
);
