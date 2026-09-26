import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { event } from "./events.ts";
import { organization, orgMember } from "./organizations.ts";
import { baseColumns, contentLanguage } from "./shared.ts";

export const contentType = pgEnum("content_type", [
	"post",
	"caption",
	"announcement",
	"press_release",
	"recap",
]);

export const contentChannel = pgEnum("content_channel", [
	"facebook",
	"instagram",
	"telegram",
	"linkedin",
	"tiktok",
	"other",
]);

/**
 * Nothing reaches an audience without passing through here. A human approves,
 * edits or rejects every item, and the outcome is written back so the agents
 * learn what this brand accepts.
 */
export const contentStatus = pgEnum("content_status", [
	"draft",
	"approved",
	"rejected",
	"published",
]);

export const contentItem = pgTable(
	"content_items",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: contentType("type").notNull(),
		channel: contentChannel("channel").notNull(),
		language: contentLanguage("language").notNull(),
		body: text("body").notNull(),
		/** Image or video references the humans will shoot and attach. */
		media: jsonb("media").$type<unknown[]>(),
		status: contentStatus("status").notNull().default("draft"),
		/**
		 * Why it was rejected or what was changed. This is the training signal —
		 * it goes back into the Brain, so it is a first-class column, not a note.
		 */
		feedback: text("feedback"),
		reviewedBy: uuid("reviewed_by").references(() => orgMember.id, {
			onDelete: "set null",
		}),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		/** Optional tie to an event the item promotes. */
		eventId: uuid("event_id").references(() => event.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("content_items_org_id_idx").on(table.orgId),
		// The approval queue is "everything in this org still waiting".
		index("content_items_org_status_idx").on(table.orgId, table.status),
		index("content_items_event_id_idx").on(table.eventId),
	],
);

export type ContentItem = typeof contentItem.$inferSelect;
