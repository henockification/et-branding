/**
 * Better Auth's tables.
 *
 * The shape here is not a guess: it mirrors exactly what `getAuthTables()`
 * reports for this configuration (email/password plus Google), so the adapter
 * finds every field it expects. Property keys must stay as Better Auth names
 * them — the adapter looks fields up by key — while the SQL column names below
 * follow this project's snake_case convention.
 *
 * Do not add product columns to these tables. Application data hangs off
 * `user.id` from its own tables instead, so a Better Auth upgrade can never
 * collide with domain fields.
 */
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const now = () => timestamp({ withTimezone: true, mode: "date" });

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: now().notNull().defaultNow(),
	updatedAt: now().notNull().defaultNow(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: now().notNull(),
	token: text("token").notNull().unique(),
	createdAt: now().notNull().defaultNow(),
	updatedAt: now().notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

/**
 * One row per credential: a password row for email sign-in, and one row per
 * linked social account holding that provider's tokens. This is the table the
 * social-publishing integrations will grow into — access and refresh tokens
 * for Instagram, LinkedIn and the rest already have a home here.
 */
export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: now(),
	refreshTokenExpiresAt: now(),
	scope: text("scope"),
	password: text("password"),
	createdAt: now().notNull().defaultNow(),
	updatedAt: now().notNull(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: now().notNull(),
	createdAt: now().notNull().defaultNow(),
	updatedAt: now().notNull().defaultNow(),
});
