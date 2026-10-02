import { MODULES, type ModuleKey } from "@et/core";
import { and, creditLedger, eq, getDb, orgModule, sql } from "@et/db";
import { type Access, readAccess, requireAccess } from "#/server/access";
import { fail } from "#/server/errors";

/**
 * Which products a workspace may use, and the credits metered ones spend.
 *
 * Module access sits on top of workspace access, never instead of it: every
 * check here starts from `readAccess`/`requireAccess`, so a module can only
 * narrow what membership already allows.
 */

export type ModuleState = {
	module: ModuleKey;
	/** Switched on and not past `paidUntil`. */
	open: boolean;
	/** Why it is closed, for the shop window; null when open. */
	closedReason: "not_subscribed" | "disabled" | "expired" | null;
	paidUntil: string | null;
	/** Metered modules only; null for unmetered ones. */
	credits: { monthly: number; used: number; remaining: number } | null;
};

/** First day of the current month, UTC, as a `date` string. */
export function currentPeriod(now = new Date()): string {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
		.toISOString()
		.slice(0, 10);
}

function today(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/** Every module's state for one workspace, in `MODULES` order. */
export async function moduleStates(orgId: string): Promise<ModuleState[]> {
	const rows = await getDb()
		.select()
		.from(orgModule)
		.where(eq(orgModule.orgId, orgId));

	const period = currentPeriod();
	return (Object.keys(MODULES) as ModuleKey[]).map((key) => {
		const row = rows.find((r) => r.module === key);
		const closedReason: ModuleState["closedReason"] = !row
			? "not_subscribed"
			: !row.enabled
				? "disabled"
				: row.paidUntil && row.paidUntil < today()
					? "expired"
					: null;

		const used = row && row.creditPeriod === period ? row.creditsUsed : 0;
		const monthly = row?.monthlyCredits ?? 0;
		return {
			module: key,
			open: closedReason === null,
			closedReason,
			paidUntil: row?.paidUntil ?? null,
			credits: MODULES[key].metered
				? { monthly, used, remaining: Math.max(0, monthly - used) }
				: null,
		};
	});
}

export async function moduleState(
	orgId: string,
	module: ModuleKey,
): Promise<ModuleState> {
	const states = await moduleStates(orgId);
	// biome-ignore lint/style/noNonNullAssertion: every key in MODULES is mapped.
	return states.find((s) => s.module === module)!;
}

/**
 * For page loaders: null when the caller cannot see the workspace, or the
 * workspace does not have the module. Same not-found either way.
 */
export async function readModuleAccess(
	orgId: string,
	module: ModuleKey,
	headers?: Headers,
): Promise<{ access: Access; state: ModuleState } | null> {
	const access = await readAccess(orgId, headers);
	if (!access) return null;
	const state = await moduleState(orgId, module);
	if (!state.open) return null;
	return { access, state };
}

/** For mutations: throws with a reason the screen can show. */
export async function requireModule(
	orgId: string,
	module: ModuleKey,
	need: "read" | "edit" | "manage",
): Promise<{ access: Access; state: ModuleState }> {
	const access = await requireAccess(orgId, need);
	const state = await moduleState(orgId, module);
	if (!state.open) {
		fail(
			state.closedReason === "expired"
				? `${MODULES[module].label} has expired for this workspace. Ask us to renew it.`
				: `${MODULES[module].label} is not part of this workspace's plan.`,
			403,
		);
	}
	return { access, state };
}

/**
 * True when the workspace has the module open. For background work — the
 * Telegram bot, the weekly cron — where there is no viewer to check.
 */
export async function hasModule(
	orgId: string,
	module: ModuleKey,
): Promise<boolean> {
	return (await moduleState(orgId, module)).open;
}

/**
 * Spend `amount` credits, or refuse if that would go over this month's
 * allowance. Race-free: the allowance check is the UPDATE's own WHERE, which
 * Postgres re-evaluates under the row lock, so concurrent spends serialise.
 */
export async function spendCredits(input: {
	orgId: string;
	module: ModuleKey;
	amount: number;
	generationId: string;
	userId: string;
}): Promise<void> {
	const db = getDb();
	const period = currentPeriod();
	// Usage this period: a row last spent in an earlier month starts at zero.
	const usedNow = sql`(case when ${orgModule.creditPeriod} = ${period} then ${orgModule.creditsUsed} else 0 end)`;

	const [updated] = await db
		.update(orgModule)
		.set({
			creditPeriod: period,
			creditsUsed: sql`${usedNow} + ${input.amount}`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(orgModule.orgId, input.orgId),
				eq(orgModule.module, input.module),
				sql`${usedNow} + ${input.amount} <= ${orgModule.monthlyCredits}`,
			),
		)
		.returning({ id: orgModule.id });

	if (!updated) {
		fail(
			"Not enough credits left this month. Ask us for a top-up, or wait for next month's allowance.",
			402,
		);
	}

	await db.insert(creditLedger).values({
		orgId: input.orgId,
		module: input.module,
		delta: -input.amount,
		reason: "generation",
		generationId: input.generationId,
		createdBy: input.userId,
	});
}

/**
 * Give back a failed generation's credits. Idempotent: the ledger allows one
 * refund per generation, and the counter only moves when that row is new.
 */
export async function refundCredits(input: {
	orgId: string;
	module: ModuleKey;
	amount: number;
	generationId: string;
	note?: string;
}): Promise<void> {
	const db = getDb();
	const [refund] = await db
		.insert(creditLedger)
		.values({
			orgId: input.orgId,
			module: input.module,
			delta: input.amount,
			reason: "refund",
			generationId: input.generationId,
			note: input.note,
		})
		.onConflictDoNothing()
		.returning({ id: creditLedger.id });
	if (!refund) return;

	await adjustUsage(input.orgId, input.module, -input.amount);
}

/**
 * Admin top-up (positive) or claw-back (negative) for the current month.
 * Moves usage rather than the monthly allowance, so it lapses with the month.
 */
export async function adjustCredits(input: {
	orgId: string;
	module: ModuleKey;
	delta: number;
	userId: string;
	note?: string;
}): Promise<void> {
	await getDb().insert(creditLedger).values({
		orgId: input.orgId,
		module: input.module,
		delta: input.delta,
		reason: "admin_adjust",
		createdBy: input.userId,
		note: input.note,
	});
	await adjustUsage(input.orgId, input.module, -input.delta);
}

/** Shift this month's usage by `by`, rolling the period over if needed. */
async function adjustUsage(
	orgId: string,
	module: ModuleKey,
	by: number,
): Promise<void> {
	const period = currentPeriod();
	await getDb()
		.update(orgModule)
		.set({
			creditPeriod: period,
			creditsUsed: sql`(case when ${orgModule.creditPeriod} = ${period} then ${orgModule.creditsUsed} else 0 end) + ${by}`,
			updatedAt: new Date(),
		})
		.where(and(eq(orgModule.orgId, orgId), eq(orgModule.module, module)));
}
