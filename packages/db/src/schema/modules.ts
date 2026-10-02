import {
	boolean,
	date,
	index,
	integer,
	numeric,
	pgEnum,
	pgTable,
	text,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { organization } from "./organizations.ts";
import { baseColumns } from "./shared.ts";

/** Mirrors `MODULES` in `@et/core`; a new module needs a value here too. */
export const moduleKey = pgEnum("module_key", ["content", "marketing"]);

/**
 * Which products a workspace subscribes to. One row per (workspace, module),
 * written only by the platform admin — payment is off-app, so "subscribed"
 * means the admin switched it on and, optionally, recorded how long it is
 * paid for.
 *
 * No row, or `enabled = false`, or `paidUntil` in the past, all mean the
 * module is closed to that workspace.
 */
export const orgModule = pgTable(
	"org_modules",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		module: moduleKey("module").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		/** Null is open-ended; otherwise the module closes the day after. */
		paidUntil: date("paid_until"),
		/** Credits granted each calendar month. Ignored by unmetered modules. */
		monthlyCredits: integer("monthly_credits").notNull().default(0),
		/**
		 * The month `creditsUsed` counts, as its first day. A spend in a later
		 * month starts the count again from zero — no reset job needed.
		 */
		creditPeriod: date("credit_period"),
		/**
		 * Credits used in `creditPeriod`, net of refunds and admin top-ups.
		 *
		 * A counter rather than a sum over the ledger because spending has to be
		 * race-free: a conditional UPDATE on this row is re-checked under the
		 * row lock, so two submits for the last credit cannot both succeed.
		 * The ledger stays the audit trail of how it got here.
		 */
		creditsUsed: integer("credits_used").notNull().default(0),
		/** Recorded, not charged — payment is off-app. */
		priceMonthly: numeric("price_monthly", { precision: 12, scale: 2 }),
		currency: text("currency").notNull().default("ETB"),
		note: text("note"),
	},
	(t) => [uniqueIndex("org_modules_org_module_key").on(t.orgId, t.module)],
);

export const creditReason = pgEnum("credit_reason", [
	"generation",
	"refund",
	"admin_adjust",
]);

/**
 * Every change to a workspace's credits, as a signed delta: a spend is
 * negative, a refund for a failed generation positive, and an admin
 * adjustment either. The audit trail behind `orgModule.creditsUsed`.
 */
export const creditLedger = pgTable(
	"credit_ledger",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		module: moduleKey("module").notNull(),
		delta: integer("delta").notNull(),
		reason: creditReason("reason").notNull(),
		/** The generation this spend or refund belongs to, if any. */
		generationId: uuid("generation_id"),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		note: text("note"),
	},
	(t) => [
		index("credit_ledger_org_module_created_idx").on(
			t.orgId,
			t.module,
			t.createdAt,
		),
		// One refund per generation, however many times a failure is reported.
		uniqueIndex("credit_ledger_generation_reason_key").on(
			t.generationId,
			t.reason,
		),
	],
);

export type OrgModule = typeof orgModule.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type ModuleKeyValue = (typeof moduleKey.enumValues)[number];
