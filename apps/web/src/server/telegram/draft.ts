import { type BrandContext, draftPost } from "@et/agents";
import { agentRun, brandProfile, contentItem, eq, getDb } from "@et/db";
import { callbackData, escapeHtml, truncateForTelegram } from "@et/telegram";
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

	// Telegram shows "typing…" for a few seconds; a draft takes about that long.
	await telegram.sendChatAction({ chatId: command.chatId, action: "typing" });

	// Opened before the call so a failure is recorded too — an action log that
	// only contains successes is not an action log.
	const [run] = await db
		.insert(agentRun)
		.values({
			orgId: command.orgId,
			agent: "content",
			input: { brief: command.brief },
			status: "running",
		})
		.returning({ id: agentRun.id });

	try {
		const draft = await draftPost({
			brand: brand as BrandContext,
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

		await telegram.sendMessage({
			chatId: command.chatId,
			text: truncateForTelegram(
				[
					escapeHtml(body),
					"",
					`<i>${draft.language.label} · ${DEFAULT_CHANNEL} · ${draft.cost.outputTokens} tokens · $${draft.cost.usd.toFixed(6)}</i>`,
				].join("\n"),
			),
			replyMarkup: {
				inline_keyboard: [
					[
						{
							text: "✅ Approve",
							callback_data: callbackData("approve", item.id),
						},
						{ text: "✏️ Edit", callback_data: callbackData("edit", item.id) },
						{
							text: "🗑 Reject",
							callback_data: callbackData("reject", item.id),
						},
					],
				],
			},
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

		await telegram.sendMessage({
			chatId: command.chatId,
			text: `I could not write that one.\n\n<code>${escapeHtml(message.slice(0, 300))}</code>`,
		});
	}
}
