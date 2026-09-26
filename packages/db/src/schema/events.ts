import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./organizations.ts";
import { baseColumns } from "./shared.ts";

export const eventStatus = pgEnum("event_status", [
	"planned",
	"announced",
	"live",
	"done",
	"cancelled",
]);

/**
 * Events the organization runs.
 *
 * Version one is about the company's own brand rather than promoting client
 * events, so this is supporting context — what the Content agent can reference
 * and count down to — not the centre of the product.
 */
export const event = pgTable(
	"events",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		startsAt: timestamp("starts_at", { withTimezone: true }),
		endsAt: timestamp("ends_at", { withTimezone: true }),
		venue: text("venue"),
		audience: text("audience"),
		/** Lists rather than tables until there is a reason to query inside them. */
		sponsors: jsonb("sponsors").$type<unknown[]>(),
		speakers: jsonb("speakers").$type<unknown[]>(),
		status: eventStatus("status").notNull().default("planned"),
	},
	(table) => [
		index("events_org_id_idx").on(table.orgId),
		index("events_starts_at_idx").on(table.startsAt),
	],
);

export type Event = typeof event.$inferSelect;
