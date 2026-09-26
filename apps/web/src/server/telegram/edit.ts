import { and, contentItem, eq, getDb, sql } from "@et/db";
import { escapeHtml, truncateForTelegram } from "@et/telegram";
import { getTelegram } from "#/server/telegram/client";

/** Below this, a "correction" is a comment rather than a rewrite. */
const MIN_LENGTH = 10;
const MAX_LENGTH = 3000;

type EditSubmission = {
	orgId: string;
	memberId: string;
	memberRole: "owner" | "approver" | "member";
	chatId: number;
	/** Eight hex characters from the draft's id, read out of the replied-to text. */
	ref: string;
	corrected: string;
};

/**
 * A human's rewrite of a draft.
 *
 * The original is kept in `feedback` rather than overwritten, because the pair
 * — what the agent wrote, and what a person changed it to — is the most
 * informative signal this system produces. "Rejected" says something was
 * wrong; an edit says exactly what.
 *
 * An edited item is approved by the same act: the person did not ask for
 * another draft, they wrote the version they wanted.
 */
export async function handleEditSubmission(
	input: EditSubmission,
): Promise<void> {
	const telegram = getTelegram();
	const db = getDb();
	const corrected = input.corrected.trim().slice(0, MAX_LENGTH);

	if (corrected.length < MIN_LENGTH) {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: "That is too short to be the corrected post. Reply with the full version you want.",
		});
		return;
	}

	if (input.memberRole === "member") {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: "Only an owner or approver can change a draft.",
		});
		return;
	}

	// Scoped to the caller's organization as well as the reference: the ref
	// comes from message text, which is client-supplied like any other input.
	const [item] = await db
		.select({
			id: contentItem.id,
			body: contentItem.body,
			originalBody: contentItem.originalBody,
		})
		.from(contentItem)
		.where(
			and(
				eq(contentItem.orgId, input.orgId),
				sql`replace(${contentItem.id}::text, '-', '') like ${`${input.ref}%`}`,
			),
		)
		.limit(1);

	if (!item) {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: "I cannot find that draft any more.",
		});
		return;
	}

	if (item.body.trim() === corrected) {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: "That is identical to the draft — nothing to change.",
		});
		return;
	}

	await db
		.update(contentItem)
		.set({
			body: corrected,
			status: "approved",
			// Only the agent's first attempt is kept. Editing an already-edited
			// item must not overwrite the original with an intermediate version.
			originalBody: item.originalBody ?? item.body,
			reviewedBy: input.memberId,
			reviewedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(contentItem.id, item.id));

	await telegram.sendMessage({
		chatId: input.chatId,
		text: truncateForTelegram(
			[
				"Saved your version and approved it.",
				"",
				escapeHtml(corrected),
				"",
				"<i>I kept the original so the agents can learn what you changed.</i>",
			].join("\n"),
		),
	});
}

/**
 * Asks for the rewrite.
 *
 * `force_reply` opens the composer already pointed at this message, so nobody
 * has to know that replying is what links their text to the draft.
 */
export async function promptForEdit(input: {
	chatId: number;
	ref: string;
}): Promise<void> {
	await getTelegram().sendMessage({
		chatId: input.chatId,
		text: [
			"Send me the version you want, as a reply to this message.",
			"",
			`<code>${input.ref}</code>`,
		].join("\n"),
		replyMarkup: {
			force_reply: true,
			input_field_placeholder: "The corrected post…",
		},
	});
}
