CREATE TABLE "spike_ledger" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"auction_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spike_ledger_auction_seq" UNIQUE("auction_id","seq")
);
