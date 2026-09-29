import {
	REFINEMENT_INSTRUCTIONS,
	type RefinementKind,
	refinePost,
} from "@et/agents";
import { agentRun, and, contentItem, eq, getDb, sql } from "@et/db";
import { escapeHtml, TelegramError, truncateForTelegram } from "@et/telegram";
import { getTelegram } from "#/server/telegram/client";
import {
	draftFooter,
	draftKeyboard,
	loadBrandContext,
} from "#/server/telegram/context";

export type RefineRequest = {
	orgId: string;
	chatId: number;
	messageId: number;
	itemId: string;
	/** A preset from a button, or free text someone replied with. */
	instruction: RefinementKind | { free: string };
};

export type RefineOutcome =
	| { status: "done" }
	| { status: "gone" }
	| { status: "decided" }
	| { status: "failed"; reason: string };

/**
 * Rewrites a draft in place.
 *
 * In place, not a new row: the draft's id is embedded in the message footer and
 * in any Edit prompt already open, so minting a new id would orphan them. The
 * item is still undecided — nobody has approved, edited or rejected it — so
 * there is nothing to preserve. `original_body` is deliberately untouched: it
 * means "what the agent wrote before a *human* replaced it", and machine
 * iterations must never be mistaken for human signal.
 *
 * Every attempt still gets its own `agent_runs` row, so the history is
 * reconstructible and the cost is attributed.
 */
/**
 * A draft is addressed two ways: a button carries the whole id, a reply carries
 * the eight-character `Draft:` prefix. Passing the prefix to an equality check
 * throws — Postgres cannot parse it as a uuid.
 */
function matchesItem(idOrRef: string) {
	return idOrRef.length === 36
		? eq(contentItem.id, idOrRef)
		: sql`replace(${contentItem.id}::text, '-', '') like ${`${idOrRef}%`}`;
}

export async function refineDraft(
	request: RefineRequest,
): Promise<RefineOutcome> {
	const db = getDb();
	const telegram = getTelegram();

	const instruction =
		typeof request.instruction === "string"
			? REFINEMENT_INSTRUCTIONS[request.instruction]
			: request.instruction.free;

	const label =
		typeof request.instruction === "string" ? request.instruction : "free_text";

	const [item] = await db
		.select({
			id: contentItem.id,
			body: contentItem.body,
			status: contentItem.status,
		})
		.from(contentItem)
		.where(
			and(eq(contentItem.orgId, request.orgId), matchesItem(request.itemId)),
		)
		.limit(1);

	if (!item) return { status: "gone" };
	// Someone may have approved or rejected it between the message being sent
	// and the button being tapped.
	if (item.status !== "draft") return { status: "decided" };

	const loaded = await loadBrandContext(request.orgId);
	if (!loaded) return { status: "failed", reason: "no brand profile" };

	const [run] = await db
		.insert(agentRun)
		.values({
			orgId: request.orgId,
			agent: "content",
			input: {
				contentItemId: item.id,
				refine: label,
				instruction,
				previousLength: item.body.length,
			},
			status: "running",
		})
		.returning({ id: agentRun.id });

	let rewritten: Awaited<ReturnType<typeof refinePost>>;

	try {
		rewritten = await refinePost({
			brand: loaded.brand,
			previousBody: item.body,
			instruction,
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
		return { status: "failed", reason: message.slice(0, 120) };
	}

	const body = rewritten.output.slice(0, 3000);

	// Guarded update: Neon's HTTP driver has no interactive transactions, so the
	// status check rides along in the WHERE clause. No row back means someone
	// decided on it while the model was working.
	const [updated] = await db
		.update(contentItem)
		.set({ body, updatedAt: new Date() })
		.where(
			and(
				eq(contentItem.id, item.id),
				eq(contentItem.orgId, request.orgId),
				eq(contentItem.status, "draft"),
			),
		)
		.returning({ id: contentItem.id });

	if (run) {
		await db
			.update(agentRun)
			.set({
				status: updated ? "succeeded" : "failed",
				modelId: rewritten.modelId,
				output: { contentItemId: item.id, body },
				inputTokens: rewritten.cost.inputTokens,
				outputTokens: rewritten.cost.outputTokens,
				usd: rewritten.cost.usd.toFixed(6),
				error: updated ? null : "decided while refining",
				finishedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(agentRun.id, run.id));
	}

	if (!updated) return { status: "decided" };

	try {
		await telegram.editMessageText({
			chatId: request.chatId,
			messageId: request.messageId,
			text: truncateForTelegram(
				[escapeHtml(body), "", draftFooter(item.id, "rewritten")].join("\n"),
			),
			// Re-passed deliberately: editMessageText defaults to an empty keyboard,
			// so omitting this would strip Approve/Edit/Reject off the draft.
			replyMarkup: draftKeyboard(item.id),
		});
	} catch (error) {
		// Repeated "Shorter" converges on a fixed point, and Telegram rejects an
		// edit that changes nothing. The database is already correct.
		if (
			error instanceof TelegramError &&
			error.description.includes("message is not modified")
		) {
			return { status: "done" };
		}
		throw error;
	}

	return { status: "done" };
}

/** Prunes handled update ids. Called from the weekly cron. */
export async function pruneHandledUpdates(): Promise<void> {
	await getDb().execute(
		sql`delete from telegram_updates where received_at < now() - interval '7 days'`,
	);
}
