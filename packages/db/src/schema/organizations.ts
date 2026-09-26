import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { baseColumns, memberRole } from "./shared.ts";

/**
 * The tenant. Every other domain table carries `orgId`, from day one and with
 * only one client, because retrofitting multi-tenancy once there is real data
 * means touching every query and every index at the same time.
 */
export const organization = pgTable(
	"organizations",
	{
		...baseColumns,
		name: text("name").notNull(),
		/** URL-safe handle, unique across the system. */
		slug: text("slug").notNull(),
	},
	(table) => [uniqueIndex("organizations_slug_key").on(table.slug)],
);

/**
 * A person inside an organization, and what they may do.
 *
 * Two identities, either or both: `userId` is a Better Auth account (our admin
 * page), `telegramUserId` is how the client's team actually shows up. Someone
 * who starts on Telegram and later gets a web login keeps one membership row
 * instead of becoming two people.
 */
export const orgMember = pgTable(
	"org_members",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		/** Telegram's numeric user id, stored as text — it exceeds int4. */
		telegramUserId: text("telegram_user_id"),
		displayName: text("display_name").notNull(),
		role: memberRole("role").notNull().default("member"),
	},
	(table) => [
		index("org_members_org_id_idx").on(table.orgId),
		// One Telegram account maps to one member; the bot resolves the sender
		// by this on every update.
		uniqueIndex("org_members_telegram_user_id_key").on(table.telegramUserId),
		uniqueIndex("org_members_org_user_key").on(table.orgId, table.userId),
	],
);

export type Organization = typeof organization.$inferSelect;
export type OrgMember = typeof orgMember.$inferSelect;
