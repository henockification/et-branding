ALTER TABLE "content_items" ADD COLUMN "original_body" text;
--> statement-breakpoint
-- Recover the pairs already captured as prose by the first version of the edit
-- flow, which stored the agent's text inside `feedback`.
UPDATE "content_items"
SET "original_body" = substring("feedback" from 'The agent had written:\s*(.*)$'),
    "feedback" = NULL
WHERE "original_body" IS NULL
  AND "feedback" LIKE 'Edited by a human. The agent had written:%';

