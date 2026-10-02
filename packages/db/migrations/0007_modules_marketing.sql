CREATE TYPE "public"."promo_kind" AS ENUM('image', 'video', 'video_voice');--> statement-breakpoint
CREATE TYPE "public"."promo_status" AS ENUM('queued', 'briefing', 'voicing', 'rendering', 'storing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."credit_reason" AS ENUM('generation', 'refund', 'admin_adjust');--> statement-breakpoint
CREATE TYPE "public"."module_key" AS ENUM('content', 'marketing');--> statement-breakpoint
CREATE TABLE "marketing_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "promo_kind" NOT NULL,
	"status" "promo_status" DEFAULT 'queued' NOT NULL,
	"settings" jsonb NOT NULL,
	"brief" jsonb,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pending_external_id" text,
	"output_key" text,
	"output_mime" text,
	"credits" integer NOT NULL,
	"provider_cost" numeric(12, 6),
	"agent_run_id" uuid,
	"error" text,
	"step_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "marketing_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"module" "module_key" NOT NULL,
	"delta" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"generation_id" uuid,
	"created_by" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "org_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"module" "module_key" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"paid_until" date,
	"monthly_credits" integer DEFAULT 0 NOT NULL,
	"credit_period" date,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"price_monthly" numeric(12, 2),
	"currency" text DEFAULT 'ETB' NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "marketing_generations" ADD CONSTRAINT "marketing_generations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_generations" ADD CONSTRAINT "marketing_generations_product_id_marketing_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."marketing_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_generations" ADD CONSTRAINT "marketing_generations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_generations" ADD CONSTRAINT "marketing_generations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_products" ADD CONSTRAINT "marketing_products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_products" ADD CONSTRAINT "marketing_products_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_modules" ADD CONSTRAINT "org_modules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_generations_product_idx" ON "marketing_generations" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "marketing_generations_org_idx" ON "marketing_generations" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "marketing_generations_pending_idx" ON "marketing_generations" USING btree ("pending_external_id");--> statement-breakpoint
CREATE INDEX "marketing_generations_status_idx" ON "marketing_generations" USING btree ("status","step_started_at");--> statement-breakpoint
CREATE INDEX "marketing_products_org_idx" ON "marketing_products" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_module_created_idx" ON "credit_ledger" USING btree ("org_id","module","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_generation_reason_key" ON "credit_ledger" USING btree ("generation_id","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "org_modules_org_module_key" ON "org_modules" USING btree ("org_id","module");--> statement-breakpoint
-- Every workspace that exists today was sold Content Studio: keep it open.
INSERT INTO "org_modules" ("org_id", "module", "enabled", "paid_until", "price_monthly", "currency")
SELECT "id", 'content', true, "paid_until", "price_monthly", "currency" FROM "organizations"
ON CONFLICT ("org_id", "module") DO NOTHING;
