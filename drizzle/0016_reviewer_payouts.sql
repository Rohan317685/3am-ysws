DO $$ BEGIN
  CREATE TYPE "public"."reviewer_entry_kind" AS ENUM('review', 'adjustment', 'payout');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviewers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slack_id" text NOT NULL,
  "email" text,
  "name" text NOT NULL,
  "added_by" text,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  "removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reviewers_slack_id_idx" ON "reviewers" USING btree ("slack_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviewer_ledger" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "reviewer_id" uuid NOT NULL,
  "kind" "reviewer_entry_kind" NOT NULL,
  "delta" numeric(12, 2) NOT NULL,
  "delivery_id" text,
  "project_id" uuid,
  "decision" text,
  "approved_minutes" integer,
  "note" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reviewer_ledger_reviewer_id_reviewers_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."reviewers"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "reviewer_ledger_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviewer_ledger_reviewer_id_idx" ON "reviewer_ledger" USING btree ("reviewer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_ledger_delivery_id_idx" ON "reviewer_ledger" USING btree ("delivery_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviewer_pay_config" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "payouts_start" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reviewer_pay_config_singleton" CHECK ("reviewer_pay_config"."id" = 1)
);
--> statement-breakpoint
INSERT INTO "reviewer_pay_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."reviewer_invoice_status" AS ENUM('requested', 'paid', 'declined');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviewer_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reviewer_id" uuid NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "status" "reviewer_invoice_status" DEFAULT 'requested' NOT NULL,
  "note" text,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "closed_by" text,
  "paid_amount" numeric(12, 2),
  "slack_sent_at" timestamp with time zone,
  CONSTRAINT "reviewer_invoices_reviewer_id_reviewers_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."reviewers"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "reviewer_invoices_amount_positive" CHECK ("reviewer_invoices"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviewer_invoices_reviewer_id_idx" ON "reviewer_invoices" USING btree ("reviewer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reviewer_invoices_one_open_idx" ON "reviewer_invoices" USING btree ("reviewer_id") WHERE "reviewer_invoices"."status" = 'requested';
