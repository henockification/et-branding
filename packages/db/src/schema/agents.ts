import {
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./organizations.ts";
import { baseColumns } from "./shared.ts";

export const agentRunStatus = pgEnum("agent_run_status", [
	"running",
	"succeeded",
	"failed",
]);

/**
 * The action log: one row per agent invocation, with what it was asked, what it
 * did, and what it cost.
 *
 * This is both the audit trail the rollout plan calls for and the cost ledger —
 * spend is attributable per organization from the first run rather than
 * reconstructed from a provider invoice later.
 */
export const agentRun = pgTable(
	"agent_runs",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Which agent: "content", "event_promo", "insights". */
		agent: text("agent").notNull(),
		/** Catalog id actually used, e.g. "deepseek:deepseek-chat". */
		modelId: text("model_id"),
		input: jsonb("input").$type<Record<string, unknown>>(),
		output: jsonb("output").$type<Record<string, unknown>>(),
		/** Every tool the agent called, in order, with arguments and results. */
		toolCalls: jsonb("tool_calls").$type<unknown[]>(),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		/**
		 * Cost in USD. `numeric`, not a float: sub-cent amounts summed over
		 * thousands of runs is exactly where binary floating point drifts.
		 */
		usd: numeric("usd", { precision: 12, scale: 6 }),
		status: agentRunStatus("status").notNull().default("running"),
		error: text("error"),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(table) => [
		index("agent_runs_org_id_idx").on(table.orgId),
		index("agent_runs_org_created_idx").on(table.orgId, table.createdAt),
	],
);

export type AgentRun = typeof agentRun.$inferSelect;
