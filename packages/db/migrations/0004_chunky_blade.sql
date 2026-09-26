CREATE TYPE "public"."content_origin" AS ENUM('ad_hoc', 'weekly_plan');--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "origin" "content_origin" DEFAULT 'ad_hoc' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "planned_for" date;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "angle" text;--> statement-breakpoint
CREATE INDEX "content_items_org_origin_idx" ON "content_items" USING btree ("org_id","origin");
--> statement-breakpoint
-- Move the weekly plan's own bookkeeping out of `feedback`, which belongs to
-- humans. The day is recovered from the prose and the week it was created in.
UPDATE "content_items"
SET "origin" = 'weekly_plan',
    "angle" = substring("feedback" from 'Planned for [A-Za-z]+: (.*)$'),
    "planned_for" = date_trunc('week', "created_at")::date
      + (CASE substring("feedback" from 'Planned for ([A-Za-z]+):')
           WHEN 'Monday' THEN 0
           WHEN 'Tuesday' THEN 1
           WHEN 'Wednesday' THEN 2
           WHEN 'Thursday' THEN 3
           WHEN 'Friday' THEN 4
           WHEN 'Saturday' THEN 5
           WHEN 'Sunday' THEN 6
           ELSE 0
         END),
    "feedback" = NULL
WHERE "feedback" LIKE 'Planned for %';

