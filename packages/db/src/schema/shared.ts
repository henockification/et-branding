import { sql } from "drizzle-orm";
import { pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Columns every domain table spreads in, so audit fields stay identical and a
 * change to them is a one-line edit. Better Auth's tables keep their own shape
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

/** Who may do what inside an organization. */
export const memberRole = pgEnum("member_role", [
	"owner",
	"approver",
	"member",
]);

/** Content is drafted in one of these; Amharic quality is tested per model. */
export const contentLanguage = pgEnum("content_language", ["am", "en"]);
