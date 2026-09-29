import {
	boolean,
	date,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { baseColumns, memberRole, workspaceStatus } from "./shared.ts";

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

		// --- Platform controls. Only the platform admin writes these; the
		// workspace's own owners can read none of the billing and change none
		// of it.
		status: workspaceStatus("status").notNull().default("active"),
		suspendedAt: timestamp("suspended_at", { withTimezone: true }),
		/** Shown to the workspace's people, so write it for them. */
		suspendedReason: text("suspended_reason"),
		/** Free text, e.g. "Starter". Plans are not a product yet, just a label. */
		plan: text("plan"),
		/** What the client pays per month. Recorded, not charged — payment is off-app. */
		priceMonthly: numeric("price_monthly", { precision: 12, scale: 2 }),
		currency: text("currency").notNull().default("ETB"),
		/** Paid up to and including this day. Past it, the console flags the workspace. */
		paidUntil: date("paid_until"),
		billingNote: text("billing_note"),
		/** People allowed in, web and Telegram together. Null is no limit. */
		seatLimit: integer("seat_limit"),
		/** Whether the workspace's owners may invite their own team. */
		teamInvitesEnabled: boolean("team_invites_enabled").notNull().default(true),
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

/**
 * An invitation for one email address to join one workspace on the web.
 *
 * A table rather than a signed token like the Telegram invite, because a web
 * invite has to be single-use, revocable and listable — and sign-up itself is
 * gated on an open invite existing for the address, which a stateless token
 * cannot answer.
 *
 * Only a hash of the token is stored: the link is shown once, when it is
 * made, and a leaked database cannot be turned into working invite links.
 */
export const orgInvite = pgTable(
	"org_invites",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Lowercased. The account that accepts must use this address. */
		email: text("email").notNull(),
		role: memberRole("role").notNull().default("owner"),
		/** SHA-256 of the token, hex. */
		tokenHash: text("token_hash").notNull(),
		/** Null when the platform admin sent it without being a member. */
		invitedBy: text("invited_by").references(() => user.id, {
			onDelete: "set null",
		}),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		acceptedAt: timestamp("accepted_at", { withTimezone: true }),
		acceptedBy: text("accepted_by").references(() => user.id, {
			onDelete: "set null",
		}),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("org_invites_token_hash_key").on(table.tokenHash),
		index("org_invites_org_id_idx").on(table.orgId),
		// Sign-up asks "is there an open invite for this address" on every attempt.
		index("org_invites_email_idx").on(table.email),
	],
);

export type Organization = typeof organization.$inferSelect;
export type OrgMember = typeof orgMember.$inferSelect;
export type OrgInvite = typeof orgInvite.$inferSelect;
