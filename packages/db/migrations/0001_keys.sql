ALTER TABLE "otp_codes" ADD COLUMN "request_ip" text;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD COLUMN "name" text DEFAULT 'Passkey' NOT NULL;--> statement-breakpoint
CREATE INDEX "otp_codes_ip_idx" ON "otp_codes" USING btree ("request_ip","created_at");