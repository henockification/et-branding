import { draftPost } from "@et/agents";
import { agentRun, contentItem, eq, getDb } from "@et/db";
import { escapeHtml, truncateForTelegram } from "@et/telegram";
import { getTelegram, tell } from "#/server/telegram/client";
import {
	draftFooter,
	draftKeyboard,
	loadBrandContext,
} from "#/server/telegram/context";

/**
 * Where a draft is destined until channel selection exists.
 *
 * The client's Meta pages are the first target, so this is the honest default
 * rather than a neutral "other" that would need fixing up later.
 */
const DEFAULT_CHANNEL = "facebook" as const;

/** How much of the model's answer is kept. Telegram caps messages anyway. */
const MAX_BODY_LENGTH = 3000;

type DraftCommand = {
	orgId: string;
	chatId: number;
	brief: string;
};

/**
 * Writes a post, stores it as a draft, and puts it in front of a human with
 * Approve / Edit / Reject and the one-tap refinements.
 *
 * Nothing here publishes anything. The draft lands in `content_items` at status
 * "draft" and only a person moves it forward.
 */
export async function handleDraftCommand(command: DraftCommand): Promise<void> {
	const telegram = getTelegram();
	const db = getDb();

	if (!command.brief.trim()) {
		await tell(
			command.chatId,
			"Tell me what to write about — for example: <code>we are hiring two camera operators</code>",
		);
		return;
	}

	const loaded = await loadBrandContext(command.orgId);

	if (!loaded) {
		await tell(
			command.chatId,
			"This workspace has no brand profile yet, so I have nothing to write in the voice of.",
		);
		return;
	}

	// Best-effort: losing a draft because a cosmetic call hiccuped would be absurd.
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
			input: { brief: command.brief, ...loaded.counts },
			status: "running",
		})
		.returning({ id: agentRun.id });

	let delivered: { body: string; itemId: string; note: string };

	// Generation and persistence first. Delivery is a separate concern below: a
	// Telegram hiccup must not relabel a draft that was written and saved.
	try {
		const draft = await draftPost({
			brand: loaded.brand,
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

		const learned =
			loaded.counts.pastPosts +
			loaded.counts.approved +
			loaded.counts.corrections;

		delivered = {
			body,
			itemId: item.id,
			note: `${draft.language.label} · learning from ${learned}`,
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

		await tell(
			command.chatId,
			`I could not write that one.\n\n<code>${escapeHtml(message.slice(0, 300))}</code>`,
		);
		return;
	}

	// Safely stored by this point; if this send fails the work is not lost.
	await telegram.sendMessage({
		chatId: command.chatId,
		text: truncateForTelegram(
			[
				escapeHtml(delivered.body),
				"",
				draftFooter(delivered.itemId, delivered.note),
			].join("\n"),
		),
		replyMarkup: draftKeyboard(delivered.itemId),
	});
}
