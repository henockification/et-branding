import { and, brandDocument, eq, getDb, sql } from "@et/db";
import { escapeHtml, type TelegramMessage } from "@et/telegram";
import { getTelegram } from "#/server/telegram/client";

/** Below this, a message is a remark rather than a post worth learning from. */
export const MIN_LENGTH = 40;

/** Telegram captions cap around 1024 characters; posts longer than this are rare. */
export const MAX_LENGTH = 8000;

/**
 * How many past posts are worth keeping per brand.
 *
 * The plan asks for 30–50 good ones. The limit is generous rather than tight
 * because the whole corpus is sent with every draft — at roughly 6,000 tokens
 * for 50 posts on a model billing $0.047 per million, that is fractions of a
 * cent, and retrieval would be premature at this size.
 */
export const MAX_DOCUMENTS = 200;

type CaptureInput = {
	orgId: string;
	chatId: number;
	message: TelegramMessage;
	text: string;
	/** True when forwarded; false when pasted behind /remember. */
	forwarded: boolean;
};

/**
 * Stores a past post in the Brand Brain.
 *
 * Forwarding is the fast path: a forwarded message is unambiguous, so it is
 * captured without a command. Typed text needs `/remember`, because otherwise
 * every "thanks" and "ok" in the chat would end up as training material.
 */
export async function capturePastPost(input: CaptureInput): Promise<void> {
	const telegram = getTelegram();
	const db = getDb();
	const text = input.text.trim();

	if (text.length < MIN_LENGTH) {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: `That is too short to learn a voice from — I keep posts of at least ${MIN_LENGTH} characters.`,
		});
		return;
	}

	const body = text.slice(0, MAX_LENGTH);

	// Forwarding the same post twice is easy to do by accident, and a duplicate
	// would quietly double that post's influence on every future draft.
	const [existing] = await db
		.select({ id: brandDocument.id })
		.from(brandDocument)
		.where(
			and(
				eq(brandDocument.orgId, input.orgId),
				eq(brandDocument.kind, "past_post"),
				eq(brandDocument.content, body),
			),
		)
		.limit(1);

	if (existing) {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: "I already have that one.",
		});
		return;
	}

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(brandDocument)
		.where(
			and(
				eq(brandDocument.orgId, input.orgId),
				eq(brandDocument.kind, "past_post"),
			),
		);

	if (count >= MAX_DOCUMENTS) {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: `The brain already holds ${MAX_DOCUMENTS} posts, which is plenty. Remove some from the dashboard before adding more.`,
		});
		return;
	}

	const origin = input.message.forward_origin;
	const sourceName =
		origin?.chat?.title ??
		origin?.sender_user?.username ??
		origin?.sender_user_name ??
		(input.forwarded ? "forwarded" : "pasted");

	await db.insert(brandDocument).values({
		orgId: input.orgId,
		kind: "past_post",
		// A first line is a better handle in a list than "Untitled".
		title: body.split("\n")[0]?.slice(0, 120) || "Past post",
		source: `telegram:${sourceName}`,
		content: body,
		metadata: {
			forwarded: input.forwarded,
			hadPhoto: Boolean(input.message.photo?.length),
			capturedAt: new Date().toISOString(),
		},
	});

	const total = count + 1;
	const photoNote = input.message.photo?.length
		? " (I kept the words; images come later.)"
		: "";

	await telegram.sendMessage({
		chatId: input.chatId,
		text: [
			`Saved. The brain now holds <b>${total}</b> past post${total === 1 ? "" : "s"}.${photoNote}`,
			total < 10
				? "\nKeep going — around 30 gives the agents a real feel for the voice."
				: "",
		].join(""),
	});
}

/** `/brain` — what the Brand Brain currently holds. */
export async function describeBrain(input: {
	orgId: string;
	chatId: number;
	brandName: string;
	hasProfile: boolean;
}): Promise<void> {
	const [{ count }] = await getDb()
		.select({ count: sql<number>`count(*)::int` })
		.from(brandDocument)
		.where(
			and(
				eq(brandDocument.orgId, input.orgId),
				eq(brandDocument.kind, "past_post"),
			),
		);

	await getTelegram().sendMessage({
		chatId: input.chatId,
		text: [
			`<b>${escapeHtml(input.brandName)}</b>`,
			`Profile: ${input.hasProfile ? "filled in" : "empty — drafts will be generic"}`,
			`Past posts: ${count}`,
			"",
			count === 0
				? "Forward me some of your best posts and I will write like them."
				: "Forward more posts any time, or use /remember to paste one.",
		].join("\n"),
	});
}
