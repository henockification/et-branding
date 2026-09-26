import { type BrandContext, draftPost } from "@et/agents";
import {
	agentRun,
	and,
	brandDocument,
	brandProfile,
	contentItem,
	desc,
	eq,
	getDb,
	isNotNull,
	isNull,
} from "@et/db";
import {
	callbackData,
	escapeHtml,
	formatRef,
	truncateForTelegram,
} from "@et/telegram";
import { getTelegram } from "#/server/telegram/client";

/**
 * Where a draft is destined until channel selection exists.
 *
 * The client's Meta pages are the first target, so this is the honest default
 * rather than a neutral "other" that would need fixing up later.
 */
const DEFAULT_CHANNEL = "facebook" as const;

/** How much of the model's answer is kept. Telegram caps messages anyway. */
const MAX_BODY_LENGTH = 3000;

/**
 * How many past posts are sent with each draft.
 *
 * The whole corpus goes into the prompt rather than a retrieved subset: fifty
 * posts is roughly 6,000 tokens, which on the cheap tier costs a fraction of a
 * cent, and embeddings would be machinery bought for a problem this size does
 * not have. Revisit when one brand has thousands of posts.
 */
const MAX_EXAMPLES = 50;

/**
 * How much of the brand's own history is replayed into each draft.
 *
 * Corrections are capped tightest because they are the strongest signal — a
 * long list of old mistakes would drown out the voice itself — and approved
 * posts are capped below past posts because they are the agent's own output
 * and risk the model reinforcing its own habits.
 */
const MAX_CORRECTIONS = 10;
const MAX_APPROVED = 20;

type DraftCommand = {
	orgId: string;
	chatId: number;
	brief: string;
};

/**
 * `/draft <brief>` — writes a post, stores it as a draft, and puts it in front
 * of a human with Approve / Reject buttons.
 *
 * Nothing here publishes anything. The draft lands in `content_items` at
 * status "draft" and only a person moves it forward, which is the whole point
 * of the rollout plan's approval step.
 */
export async function handleDraftCommand(command: DraftCommand): Promise<void> {
	const telegram = getTelegram();
	const db = getDb();

	if (!command.brief) {
		await telegram.sendMessage({
			chatId: command.chatId,
			text: "Tell me what to write about, like:\n<code>/draft we are hiring two camera operators</code>",
		});
		return;
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
		.where(eq(brandProfile.orgId, command.orgId))
		.limit(1);

	if (!brand) {
		await telegram.sendMessage({
			chatId: command.chatId,
			text: "This workspace has no brand profile yet, so I have nothing to write in the voice of.",
		});
		return;
	}

	// Newest first: a brand's recent voice is more representative than its oldest.
	const examples = await db
		.select({ content: brandDocument.content })
		.from(brandDocument)
		.where(
			and(
				eq(brandDocument.orgId, command.orgId),
				eq(brandDocument.kind, "past_post"),
			),
		)
		.orderBy(desc(brandDocument.createdAt))
		.limit(MAX_EXAMPLES);

	// Posts a human approved untouched: the agent got these right.
	const approved = await db
		.select({ body: contentItem.body })
		.from(contentItem)
		.where(
			and(
				eq(contentItem.orgId, command.orgId),
				eq(contentItem.status, "approved"),
				isNull(contentItem.originalBody),
			),
		)
		.orderBy(desc(contentItem.reviewedAt))
		.limit(MAX_APPROVED);

	// Posts a human rewrote: the pair says exactly what was wrong.
	const corrections = await db
		.select({ before: contentItem.originalBody, after: contentItem.body })
		.from(contentItem)
		.where(
			and(
				eq(contentItem.orgId, command.orgId),
				isNotNull(contentItem.originalBody),
			),
		)
		.orderBy(desc(contentItem.reviewedAt))
		.limit(MAX_CORRECTIONS);

	// Telegram shows "typing…" for a few seconds; a draft takes about that long.
	// Best-effort: this is decoration, and losing a draft because a cosmetic
	// call hiccuped would be absurd.
	await telegram
		.sendChatAction({ chatId: command.chatId, action: "typing" })
		.catch(() => {});

	// Opened before the call so a failure is recorded too — an action log that
	// only contains successes is not an action log.
	const [run] = await db
		.insert(agentRun)
		.values({
			orgId: command.orgId,
			agent: "content",
			input: {
				brief: command.brief,
				pastPosts: examples.length,
				approved: approved.length,
				corrections: corrections.length,
			},
			status: "running",
		})
		.returning({ id: agentRun.id });

	let delivered: { body: string; itemId: string; note: string };

	// Generation and persistence first. Delivery is a separate concern below:
	// a Telegram hiccup must not relabel a draft that was written and saved.
	try {
		const draft = await draftPost({
			brand: {
				...(brand as BrandContext),
				examples: [
					...examples.map((example) => example.content),
					...approved.map((item) => item.body),
				],
				corrections: corrections.flatMap((correction) =>
					correction.before
						? [{ before: correction.before, after: correction.after }]
						: [],
				),
			},
			brief: command.brief,
		});

		const body = draft.output.slice(0, MAX_BODY_LENGTH);

		const [item] = await db
			.insert(contentItem)
			.values({
				orgId: command.orgId,
				type: "post",
				channel: DEFAULT_CHANNEL,
				language: draft.language.code,
				body,
				status: "draft",
			})
			.returning({ id: contentItem.id });

		if (!item) throw new Error("Draft could not be saved.");

		if (run) {
			await db
				.update(agentRun)
				.set({
					status: "succeeded",
					modelId: draft.modelId,
					output: { contentItemId: item.id, body },
					inputTokens: draft.cost.inputTokens,
					outputTokens: draft.cost.outputTokens,
					usd: draft.cost.usd.toFixed(6),
					finishedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(agentRun.id, run.id));
		}

		delivered = {
			body,
			itemId: item.id,
			note: `${draft.language.label} · ${DEFAULT_CHANNEL} · learning from ${examples.length + approved.length} post${examples.length + approved.length === 1 ? "" : "s"}, ${corrections.length} correction${corrections.length === 1 ? "" : "s"} · $${draft.cost.usd.toFixed(6)}\n${formatRef(item.id)}`,
		};
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

		await telegram
			.sendMessage({
				chatId: command.chatId,
				text: `I could not write that one.\n\n<code>${escapeHtml(message.slice(0, 300))}</code>`,
			})
			.catch(() => {});
		return;
	}

	// The draft is safely stored by this point; if this send fails the work is
	// not lost, and the log already says the run succeeded.
	await telegram.sendMessage({
		chatId: command.chatId,
		text: truncateForTelegram(
			[escapeHtml(delivered.body), "", `<i>${delivered.note}</i>`].join("\n"),
		),
		replyMarkup: {
			inline_keyboard: [
				[
					{
						text: "✅ Approve",
						callback_data: callbackData("approve", delivered.itemId),
					},
					{
						text: "✏️ Edit",
						callback_data: callbackData("edit", delivered.itemId),
					},
					{
						text: "🗑 Reject",
						callback_data: callbackData("reject", delivered.itemId),
					},
				],
			],
		},
	});
}
