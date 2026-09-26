-- The Brand Brain stores embeddings, so pgvector must exist before the
-- brand_document_chunks table that uses it. Neon ships 0.8.6.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('guideline', 'past_post', 'press_release', 'transcript', 'other');--> statement-breakpoint
CREATE TYPE "public"."content_channel" AS ENUM('facebook', 'instagram', 'telegram', 'linkedin', 'tiktok', 'other');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'approved', 'rejected', 'published');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('post', 'caption', 'announcement', 'press_release', 'recap');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('planned', 'announced', 'live', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('meta', 'telegram', 'tiktok', 'linkedin');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."content_language" AS ENUM('am', 'en');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'approver', 'member');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"model_id" text,
	"input" jsonb,
	"output" jsonb,
	"tool_calls" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"usd" numeric(12, 6),
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brand_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "document_kind" DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"content" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "brand_document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"voice" jsonb,
	"audience" jsonb,
	"services" jsonb,
	"visual_identity" jsonb
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "content_type" NOT NULL,
	"channel" "content_channel" NOT NULL,
	"language" "content_language" NOT NULL,
	"body" text NOT NULL,
	"media" jsonb,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"feedback" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"venue" text,
	"audience" text,
	"sponsors" jsonb,
	"speakers" jsonb,
	"status" "event_status" DEFAULT 'planned' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"external_id" text,
	"display_name" text,
	"credentials" text,
	"metadata" jsonb,
	"status" "integration_status" DEFAULT 'connected' NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text,
	"telegram_user_id" text,
	"display_name" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_documents" ADD CONSTRAINT "brand_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_document_chunks" ADD CONSTRAINT "brand_document_chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_document_chunks" ADD CONSTRAINT "brand_document_chunks_document_id_brand_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."brand_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_reviewed_by_org_members_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."org_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_org_id_idx" ON "agent_runs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "agent_runs_org_created_idx" ON "agent_runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "brand_documents_org_id_idx" ON "brand_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "brand_document_chunks_org_id_idx" ON "brand_document_chunks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "brand_document_chunks_document_id_idx" ON "brand_document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "brand_document_chunks_embedding_idx" ON "brand_document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "brand_profiles_org_id_key" ON "brand_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "content_items_org_id_idx" ON "content_items" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "content_items_org_status_idx" ON "content_items" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "content_items_event_id_idx" ON "content_items" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_org_id_idx" ON "events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "integrations_org_id_idx" ON "integrations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_provider_external_key" ON "integrations" USING btree ("org_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "org_members_org_id_idx" ON "org_members" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_telegram_user_id_key" ON "org_members" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_key" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree ("slug");

--> statement-breakpoint
-- Carry the pre-multi-tenancy `brand` rows across before 0002 drops the table.
-- Each legacy brand becomes its own organization, reusing the brand's id as the
-- org id so the three inserts below correlate without a temporary key.
INSERT INTO "organizations" ("id", "name", "slug", "created_at", "updated_at")
SELECT
  b."id",
  b."name",
  trim(both '-' from lower(regexp_replace(b."name", '[^a-zA-Z0-9]+', '-', 'g')))
    || '-' || substr(md5(b."id"::text), 1, 6),
  b."created_at",
  b."updated_at"
FROM "brand" b;--> statement-breakpoint
INSERT INTO "brand_profiles" ("org_id", "name", "summary", "created_at", "updated_at")
SELECT b."id", b."name", b."summary", b."created_at", b."updated_at"
FROM "brand" b;--> statement-breakpoint
INSERT INTO "org_members" ("org_id", "user_id", "display_name", "role", "created_at", "updated_at")
SELECT b."id", b."owner_id", COALESCE(u."name", u."email"), 'owner', b."created_at", b."updated_at"
FROM "brand" b
JOIN "user" u ON u."id" = b."owner_id";
