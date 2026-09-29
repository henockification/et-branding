import {
	date,
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
/**
 * Where an item came from.
 *
 * Structural, not inferred from prose. The weekly plan used to record itself in
 * `feedback` — the same column rejection reasons use — so rejecting a planned
 * post either lost the plan or fed "Planned for Wednesday…" to the model as the
 * reason it was thrown out.
 */
export const contentOrigin = pgEnum("content_origin", [
	"ad_hoc",
	"weekly_plan",
]);

export const contentStatus = pgEnum("content_status", [
	"draft",
	"approved",
	"rejected",
	"published",
]);

/**
 * A photo that goes out with a post.
 *
 * Both versions are kept: the polish is a suggestion, and "Use original" has
 * to be able to take it back without asking anyone to resend the picture. The
 * keys are R2 object keys under `orgs/{orgId}/media/{id}/`, never public URLs.
 */
export type ContentPhoto = {
	kind: "photo";
	id: string;
	originalKey: string;
	polishedKey: string;
	/** Which version the human chose. Starts as "polished". */
	selected: "original" | "polished";
	/** The edits applied, as numbers, so a bad polish can be diagnosed later. */
	adjustments: Record<string, number | string>;
	/** What the vision step saw, as given to the copywriter. */
	description: string;
};

export type ContentMedia = ContentPhoto;

export const contentItem = pgTable(
	"content_items",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: contentType("type").notNull(),
		origin: contentOrigin("origin").notNull().default("ad_hoc"),
		/** The day the plan intended this for. Null for anything ad hoc. */
		plannedFor: date("planned_for"),
		/** One line on why the plan included it, written by the planner. */
		angle: text("angle"),
		channel: contentChannel("channel").notNull(),
		language: contentLanguage("language").notNull(),
		body: text("body").notNull(),
		/** Photos that go out with the post. Nothing but photos yet. */
		media: jsonb("media").$type<ContentMedia[]>(),
		status: contentStatus("status").notNull().default("draft"),
		/**
		 * A human's note: why it was rejected, or what they were going for.
		 * Free text, for people.
		 */
		feedback: text("feedback"),
		/**
		 * What the agent wrote, when a human replaced it.
		 *
		 * Kept as its own column rather than folded into `feedback` prose: the
		 * pair (original, corrected) is read back into later prompts, and parsing
		 * it out of a sentence would break the moment that sentence is reworded.
		 * Null means the body is still the agent's own words.
		 */
		originalBody: text("original_body"),
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
		index("content_items_org_origin_idx").on(table.orgId, table.origin),
	],
);

export type ContentItem = typeof contentItem.$inferSelect;
