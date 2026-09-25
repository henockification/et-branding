/**
 * A brand is the thing the agent team works on. One user owns many brands.
 *
 * Ownership is a plain `ownerId` rather than a membership table: adding teams
 * later means adding `brand_member` alongside this, not reworking what a brand
 * belongs to.
 */
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Columns every domain table spreads in, so audit fields stay identical and a
 * change to them is a one-line edit. Auth tables keep Better Auth's own shape
 * and deliberately do not use these.
 */
export const baseColumns = {
	id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const brand = pgTable(
	"brand",
	{
		...baseColumns,
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** One line the agents write in: who this brand is for and how it sounds. */
		summary: text("summary"),
	},
	(table) => [index("brand_owner_id_idx").on(table.ownerId)],
);

export type Brand = typeof brand.$inferSelect;
export type NewBrand = typeof brand.$inferInsert;
