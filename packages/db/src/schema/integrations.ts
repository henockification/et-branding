import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./organizations.ts";
import { baseColumns } from "./shared.ts";

export const integrationProvider = pgEnum("integration_provider", [
	"meta",
	"telegram",
	"tiktok",
	"linkedin",
]);

export const integrationStatus = pgEnum("integration_status", [
	"connected",
	"expired",
	"revoked",
]);

/**
 * Third-party account access: Meta page tokens and the like.
 *
 * `credentials` holds ciphertext, never a raw token — the application encrypts
 * before writing and decrypts on use, so a database dump or an over-broad read
 * query does not hand over the client's social accounts. Everything needed to
 * display or route on is in `metadata`, which stays in the clear.
 */
export const integration = pgTable(
	"integrations",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: integrationProvider("provider").notNull(),
		/** The provider's own id for the connected page or account. */
		externalId: text("external_id"),
		displayName: text("display_name"),
		credentials: text("credentials"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		status: integrationStatus("status").notNull().default("connected"),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
	},
	(table) => [
		index("integrations_org_id_idx").on(table.orgId),
		uniqueIndex("integrations_org_provider_external_key").on(
			table.orgId,
			table.provider,
			table.externalId,
		),
	],
);

export type Integration = typeof integration.$inferSelect;
