import { type BrandContext, planWeek, WEEKDAYS, weekStart } from "@et/agents";
import {
	agentRun,
	and,
	brandProfile,
	contentItem,
	desc,
	eq,
	getDb,
	gte,
	inArray,
	isNotNull,
	organization,
	orgMember,
	sql,
} from "@et/db";
import { escapeHtml, truncateForTelegram } from "@et/telegram";
import { getTelegram } from "#/server/telegram/client";
import { draftFooter, draftKeyboard } from "#/server/telegram/context";

const AGENT = "weekly_plan";
const DEFAULT_CHANNEL = "facebook" as const;

/** Posts to show the planner so it does not repeat itself. */
const RECENT_LIMIT = 20;

/**
 * Who gets the plan: people who can actually act on it. A `member` cannot
 * approve or edit, so sending them five drafts would be noise.
 */
const RECIPIENT_ROLES = ["owner", "approver"] as const;

/** The date of `day` in the week beginning `monday`, as YYYY-MM-DD. */
function dayToDate(monday: Date, day: (typeof WEEKDAYS)[number]): string {
	const date = new Date(monday);
	date.setUTCDate(date.getUTCDate() + WEEKDAYS.indexOf(day));
	return date.toISOString().slice(0, 10);
}

export type PlanOutcome =
	| { status: "sent"; posts: number; usd: number }
	| { status: "skipped"; reason: string };

/**
 * Builds and delivers one organization's week.
 *
 * Idempotent per week: a cron that fires twice, or a retry after a partial
 * failure, must not produce two plans. The guard is a successful `weekly_plan`
 * run already recorded for this week, which is cheaper and more honest than a
 * lock — the action log is the source of truth for what has run.
 */
export async function runWeeklyPlan(options: {
	orgId: string;
	now?: Date;
	/** Set when a human asked for it, which bypasses the once-a-week guard. */
	force?: boolean;
}): Promise<PlanOutcome> {
	const db = getDb();
	const now = options.now ?? new Date();
	const monday = weekStart(now);

	if (!options.force) {
		const [existing] = await db
			.select({ id: agentRun.id })
			.from(agentRun)
			.where(
				and(
					eq(agentRun.orgId, options.orgId),
					eq(agentRun.agent, AGENT),
					eq(agentRun.status, "succeeded"),
					gte(agentRun.createdAt, monday),
				),
			)
			.limit(1);

		if (existing) {
			return { status: "skipped", reason: "already planned this week" };
		}
	}

	const [brand] = await db
		.select({
			name: brandProfile.name,
			summary: brandProfile.summary,
			voice: brandProfile.voice,
			audience: brandProfile.audience,
			services: brandProfile.services,
		})
		.from(brandProfile)
		.where(eq(brandProfile.orgId, options.orgId))
		.limit(1);

	// A plan built from nothing would be five generic adverts, which is worse
	// than no plan: it trains people to ignore the Monday message.
	if (!brand?.summary) {
		return { status: "skipped", reason: "brand profile is empty" };
	}

	const recipients = await db
		.select({ telegramUserId: orgMember.telegramUserId })
		.from(orgMember)
		.where(
			and(
				eq(orgMember.orgId, options.orgId),
				isNotNull(orgMember.telegramUserId),
				inArray(orgMember.role, [...RECIPIENT_ROLES]),
			),
		);

	if (recipients.length === 0) {
		return { status: "skipped", reason: "nobody to send it to" };
	}

	// Approved and published only. A rejected draft was never posted, so telling
	// the planner to avoid repeating it would steer it away from a subject the
	// brand may well still want covered.
	const recent = await db
		.select({ body: contentItem.body })
		.from(contentItem)
		.where(
			and(
				eq(contentItem.orgId, options.orgId),
				inArray(contentItem.status, ["approved", "published"]),
			),
		)
		.orderBy(desc(contentItem.createdAt))
		.limit(RECENT_LIMIT);

	const [run] = await db
		.insert(agentRun)
		.values({
			orgId: options.orgId,
			agent: AGENT,
			input: {
				weekStarting: monday.toISOString(),
				forced: Boolean(options.force),
			},
			status: "running",
		})
		.returning({ id: agentRun.id });

	let plan: Awaited<ReturnType<typeof planWeek>>;

	try {
		plan = await planWeek({
			brand: brand as BrandContext,
			recent: recent.map((item) => item.body),
			weekStarting: monday,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (run) {
			await db
				.update(agentRun)
				.set({
					status: "failed",
					error: message.slice(0, 500),
					finishedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(agentRun.id, run.id));
		}
		return { status: "skipped", reason: message.slice(0, 120) };
	}

	const saved = await db
		.insert(contentItem)
		.values(
			plan.posts.map((post) => ({
				orgId: options.orgId,
				type: "post" as const,
				origin: "weekly_plan" as const,
				// A real date, not a weekday name: the plan is for one specific
				// week, and a calendar needs something it can sort.
				plannedFor: dayToDate(monday, post.day),
				angle: post.angle,
				channel: DEFAULT_CHANNEL,
				language: plan.language.code,
				body: post.body,
				status: "draft" as const,
				// `feedback` stays empty: it belongs to whoever reviews this.
			})),
		)
		.returning({ id: contentItem.id, body: contentItem.body });

	if (run) {
		await db
			.update(agentRun)
			.set({
				status: "succeeded",
				modelId: plan.modelId,
				output: { posts: saved.length, ids: saved.map((item) => item.id) },
				inputTokens: plan.cost.inputTokens,
				outputTokens: plan.cost.outputTokens,
				usd: plan.cost.usd.toFixed(6),
				finishedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(agentRun.id, run.id));
	}

	// Delivery after the work is recorded, so a Telegram failure cannot lose a
	// plan that was generated and stored.
	await deliver({
		recipients: recipients.map((r) => Number(r.telegramUserId)),
		brandName: brand.name,
		posts: plan.posts.map((post, index) => ({
			...post,
			id: saved[index]?.id ?? "",
		})),
		usd: plan.cost.usd,
	});

	return { status: "sent", posts: saved.length, usd: plan.cost.usd };
}

async function deliver(input: {
	recipients: number[];
	brandName: string;
	posts: { id: string; day: string; angle: string; body: string }[];
	usd: number;
}): Promise<void> {
	const telegram = getTelegram();

	for (const chatId of input.recipients) {
		await telegram
			.sendMessage({
				chatId,
				text: [
					`<b>This week for ${escapeHtml(input.brandName)}</b>`,
					`${input.posts.length} posts, waiting on you. Approve, edit or reject each one.`,
					`<i>$${input.usd.toFixed(6)}</i>`,
				].join("\n"),
			})
			.catch(() => {});

		for (const post of input.posts) {
			if (!post.id) continue;

			await telegram
				.sendMessage({
					chatId,
					text: truncateForTelegram(
						[
							`<b>${escapeHtml(post.day)}</b> — <i>${escapeHtml(post.angle)}</i>`,
							"",
							escapeHtml(post.body),
							"",
							draftFooter(post.id, `${post.day} · ${post.angle}`),
						].join("\n"),
					),
					replyMarkup: draftKeyboard(post.id),
				})
				.catch(() => {});
		}
	}
}

/**
 * Every organization the scheduler should consider.
 *
 * Filtering happens inside `runWeeklyPlan` rather than here so each skip is
 * explained rather than silently excluded by a query.
 */
export async function organizationsToPlan(): Promise<
	{ id: string; name: string }[]
> {
	return (
		getDb()
			.select({ id: organization.id, name: organization.name })
			.from(organization)
			// A suspended workspace gets nothing — and costs nothing.
			.where(eq(organization.status, "active"))
			.orderBy(sql`${organization.createdAt} asc`)
	);
}
