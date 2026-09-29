import {
	and,
	brandProfile,
	contentItem,
	eq,
	getDb,
	organization,
	orgMember,
	telegramUpdate,
} from "@et/db";
import {
	escapeHtml,
	formatRef,
	isForwarded,
	isRefinement,
	keyboardAction,
	MAIN_KEYBOARD,
	messageImage,
	messageText,
	normaliseLabel,
	parseCallbackData,
	parseRef,
	type TelegramMessage,
	type TelegramUpdate,
	truncateForTelegram,
	verifyInviteToken,
} from "@et/telegram";
import { capturePastPost, describeBrain } from "#/server/telegram/capture";
import {
	acknowledge,
	getTelegram,
	inviteSecret,
	tell,
} from "#/server/telegram/client";
import { handleDraftCommand } from "#/server/telegram/draft";
import {
	handleEditSubmission,
	handleRejectionReason,
	promptForEdit,
	promptForReason,
} from "#/server/telegram/edit";
import { choosePhoto, handlePhotoDraft } from "#/server/telegram/photo-draft";
import { refineDraft } from "#/server/telegram/refine";
import { runWeeklyPlan } from "#/server/telegram/weekly";

/** A linked Telegram user, resolved to their membership. */
type Member = {
	memberId: string;
	orgId: string;
	orgName: string;
	role: "owner" | "approver" | "member";
	displayName: string;
};

async function findMember(telegramUserId: number): Promise<Member | null> {
	const [row] = await getDb()
		.select({
			memberId: orgMember.id,
			orgId: orgMember.orgId,
			orgName: organization.name,
			role: orgMember.role,
			displayName: orgMember.displayName,
		})
		.from(orgMember)
		.innerJoin(organization, eq(organization.id, orgMember.orgId))
		.where(eq(orgMember.telegramUserId, String(telegramUserId)))
		.limit(1);

	return row ?? null;
}

const HELP = [
	"<b>Just tell me what to write.</b>",
	"",
	"Type it however you like — <i>we are hiring two camera operators</i> — and I will draft a post. No commands needed.",
	"",
	"<b>Send a photo</b> — from an event, the office, anywhere — with a line about it or without. I give it a light, natural touch-up and write the post to go with it.",
	"",
	"<b>Forward me your best past posts.</b> I keep them and write like them.",
	"",
	"On every draft: <b>Approve</b>, <b>Edit</b> or <b>Reject</b>, and <b>Try again</b> / <b>Shorter</b> / <b>Add a CTA</b> for another go. You can also just reply to a draft telling me what to change.",
	"",
	"Buttons at the bottom do the rest. If you prefer typing: /draft, /plan, /brain, /remember, /whoami, /start.",
	"",
	"Nothing I write is published. Every draft waits for a human.",
].join("\n");

/**
 * Routes one Telegram update.
 *
 * Always resolves. Telegram retries any webhook that does not answer 200, and a
 * retry storm on a bug is worse than a dropped update — so failures are logged
 * and reported to the user, never thrown back at Telegram.
 */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
	try {
		if (update.callback_query) {
			await handleCallback(update.callback_query);
			return;
		}

		const message = update.message;
		if (!message || !message.from || message.from.is_bot) return;

		// A photo someone took is a brief in itself, caption or not. A forwarded
		// one is someone else's post and stays on the learn-from-it path below.
		const image = messageImage(message);
		if (image && !isForwarded(message)) {
			await handlePhoto(message, image.fileId);
			return;
		}

		const text = messageText(message);

		// Silence reads as "the bot is broken". Anything without words gets an
		// honest one-liner rather than nothing at all.
		if (!text) {
			await handleNonText(message);
			return;
		}

		await handleMessage({
			chatId: message.chat.id,
			from: message.from,
			text: text.trim(),
			message,
		});
	} catch (error) {
		console.error("telegram update failed", error);
	}
}

async function handleMessage(input: {
	chatId: number;
	from: { id: number; first_name: string; username?: string };
	text: string;
	message: TelegramMessage;
}): Promise<void> {
	const telegram = getTelegram();
	const { command, argument } = parseCommand(input.text);

	if (command === "/start") {
		await handleStart({ ...input, argument });
		return;
	}

	const member = await findMember(input.from.id);

	if (!member) {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: "This chat is not linked to a workspace yet. Ask your admin for an invite link and open it, or send /start with the invite code.",
		});
		return;
	}

	// A reply to a message carrying a draft reference is a rewrite of that
	// draft. Checked first: the corrected post is arbitrary text and could
	// otherwise look like a command or a forward.
	const repliedTo = input.message.reply_to_message;
	const ref = repliedTo ? parseRef(messageText(repliedTo)) : null;

	// Replying to a delivered draft is the most natural way to ask for a change
	// ("make it shorter, mention the price"). It is an instruction, not a
	// rewrite — a rewrite only ever comes from the Edit prompt.
	if (ref?.kind === "draft") {
		if (member.role === "member") {
			await tell(input.chatId, "Only an owner or approver can change a draft.");
			return;
		}

		await tell(input.chatId, "Rewriting…");

		const outcome = await refineDraft({
			orgId: member.orgId,
			chatId: input.chatId,
			messageId: repliedTo?.message_id ?? 0,
			itemId: ref.id,
			instruction: { free: input.text },
		});

		await reportRefineOutcome(input.chatId, outcome);
		return;
	}

	if (ref?.kind === "reason") {
		await handleRejectionReason({
			orgId: member.orgId,
			memberRole: member.role,
			chatId: input.chatId,
			ref: ref.id,
			reason: input.text,
		});
		return;
	}

	if (ref) {
		await handleEditSubmission({
			orgId: member.orgId,
			memberId: member.memberId,
			memberRole: member.role,
			chatId: input.chatId,
			ref: ref.id,
			corrected: input.text,
		});
		return;
	}

	// A forwarded message is an unambiguous "learn from this", so it needs no
	// command. Typed text does, or every "ok" in the chat becomes training data.
	if (isForwarded(input.message)) {
		await capturePastPost({
			orgId: member.orgId,
			chatId: input.chatId,
			message: input.message,
			text: input.text,
			forwarded: true,
		});
		return;
	}

	switch (command) {
		case "/remember":
			await capturePastPost({
				orgId: member.orgId,
				chatId: input.chatId,
				message: input.message,
				text: argument,
				forwarded: false,
			});
			return;

		case "/brain":
			await describeBrainFor(member, input.chatId);
			return;

		case "/plan":
			await runPlanFor(member, input.chatId);
			return;

		case "/draft":
			await handleDraftCommand({
				orgId: member.orgId,
				chatId: input.chatId,
				brief: argument,
			});
			return;

		case "/help":
			await tell(input.chatId, HELP);
			return;

		case "/whoami": {
			const [brand] = await getDb()
				.select({ name: brandProfile.name })
				.from(brandProfile)
				.where(eq(brandProfile.orgId, member.orgId))
				.limit(1);

			await telegram.sendMessage({
				chatId: input.chatId,
				text: [
					`<b>${escapeHtml(member.displayName)}</b>`,
					`Workspace: ${escapeHtml(member.orgName)}`,
					`Brand: ${escapeHtml(brand?.name ?? "not set up yet")}`,
					`Role: ${member.role}`,
				].join("\n"),
			});
			return;
		}

		default:
			break;
	}

	// A keyboard button sends its label as ordinary text. Matched on the whole
	// message, never a prefix: a real brief often starts "write a post about…".
	const intent = keyboardAction(input.text);

	if (intent === "help") {
		await tell(input.chatId, HELP);
		return;
	}

	if (intent === "brain") {
		await describeBrainFor(member, input.chatId);
		return;
	}

	if (intent === "plan") {
		await runPlanFor(member, input.chatId);
		return;
	}

	if (intent === "draft") {
		await promptForBrief(input.chatId);
		return;
	}

	// A slash command we do not have. Say so briefly — dumping the whole help
	// block on every typo is noise, and the keyboard is on screen anyway.
	if (command) {
		await tell(
			input.chatId,
			`I do not know <code>${escapeHtml(command)}</code>. Tap a button below, or just tell me what to post about.`,
		);
		return;
	}

	// Acknowledgements are not briefs. Without this every "ok" is a paid call.
	if (isSmallTalk(input.text)) {
		await tell(input.chatId, "👍");
		return;
	}

	// Anything else is what to write about.
	await handleDraftCommand({
		orgId: member.orgId,
		chatId: input.chatId,
		brief: input.text,
	});
}

/**
 * A command is a slash, a name, and optionally the bot's username.
 *
 * Telegram appends `@botname` in groups, which the old first-token match never
 * stripped — so `/help@negaritbrand_bot` fell through to "I do not know that
 * one yet". Anything that fails this grammar (`/ 20% off`, `/2 days to go`) is
 * prose, not a command.
 */
function parseCommand(text: string): {
	command: string | null;
	argument: string;
} {
	const [first, ...rest] = text.split(/\s+/);
	const match = first
		? /^\/([A-Za-z0-9_]{1,32})(?:@[A-Za-z0-9_]{5,32})?$/.exec(first)
		: null;

	return {
		command: match?.[1] ? `/${match[1].toLowerCase()}` : null,
		argument: rest.join(" "),
	};
}

/**
 * Words that carry no brief on their own.
 *
 * Matched per word rather than as whole phrases: a set of phrases missed
 * "ok thanks" and turned an acknowledgement into a paid model call — precisely
 * what this guard exists to stop.
 */
const SMALL_TALK_WORDS = new Set([
	"ok",
	"okay",
	"k",
	"thanks",
	"thank",
	"you",
	"ta",
	"got",
	"it",
	"yes",
	"yep",
	"no",
	"nope",
	"cool",
	"nice",
	"great",
	"good",
	"sure",
	"hi",
	"hello",
	"hey",
	"morning",
	"please",
	"done",
	"perfect",
]);

/** A short message made entirely of pleasantries is not a brief. */
function isSmallTalk(text: string): boolean {
	const normalised = normaliseLabel(text);
	if (normalised.length === 0) return true;

	const words = normalised.split(" ");
	// A real brief is longer than this even when terse ("hiring two camera ops").
	if (words.length > 4) return false;

	return words.every((word) => SMALL_TALK_WORDS.has(word));
}

/** The largest file the Bot API lets a bot download. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * A photo sent to be posted.
 *
 * Albums arrive as one update per photo, with the caption on only one of them.
 * One post per photo is all this does for now, so the captioned photo is used
 * and the rest are declined — once per album, not once per photo.
 */
async function handlePhoto(
	message: TelegramMessage,
	fileId: string,
): Promise<void> {
	const chatId = message.chat.id;
	const member = message.from ? await findMember(message.from.id) : null;

	if (!member) {
		await tell(
			chatId,
			"This chat is not linked to a workspace yet. Ask your admin for an invite link and open it, or send /start with the invite code.",
		);
		return;
	}

	const caption = message.caption?.trim() ?? "";

	if (message.media_group_id && !caption) {
		if (await claimOnce(`album:${message.media_group_id}`)) {
			await tell(
				chatId,
				"I write one post per photo for now, so from an album I only use the photo that has the caption. If none had one, send the photo you want on its own.",
			);
		}
		return;
	}

	const size = messageImage(message)?.fileSize;
	if (size && size > MAX_DOWNLOAD_BYTES) {
		await tell(
			chatId,
			"That file is over 20 MB, which is more than Telegram lets me download. Send it as a photo rather than a file.",
		);
		return;
	}

	await handlePhotoDraft({ orgId: member.orgId, chatId, fileId, caption });
}

/**
 * True the first time it is called with `key`, false after.
 *
 * Borrows `telegram_updates`, whose job is already exactly this for update
 * ids. Real update ids are positive, so the key is hashed into the negative
 * range where it cannot collide with one, and the existing seven-day cleanup
 * clears it with the rest.
 */
async function claimOnce(key: string): Promise<boolean> {
	// FNV-1a, folded to 52 bits so it survives the trip through a JS number.
	let hash = 0xcbf29ce484222325n;
	for (const char of key) {
		hash ^= BigInt(char.codePointAt(0) ?? 0);
		hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
	}
	const syntheticId = -Number((hash % (1n << 52n)) + 1n);

	const [claimed] = await getDb()
		.insert(telegramUpdate)
		.values({ updateId: syntheticId })
		.onConflictDoNothing()
		.returning({ updateId: telegramUpdate.updateId });

	return Boolean(claimed);
}

/** Non-text messages: say something honest rather than nothing. */
async function handleNonText(message: TelegramMessage): Promise<void> {
	const chatId = message.chat.id;

	// Only forwarded photos reach here; ones taken to be posted go to handlePhoto.
	if (message.photo?.length) {
		await tell(
			chatId,
			"That came through without any words, so there is nothing for me to learn from. Forward one with its caption.",
		);
		return;
	}

	await tell(
		chatId,
		"I can only read words for now. Type what you want, or forward a post and I will learn from it.",
	);
}

/**
 * `/start <invite>` links this Telegram account to a workspace.
 *
 * The invite is a signed token, so no invite table is needed and a link cannot
 * be forged by guessing an org id. Linking is idempotent: opening the same
 * invite twice updates the existing membership rather than creating a second.
 */
async function handleStart(input: {
	chatId: number;
	from: { id: number; first_name: string; username?: string };
	argument: string;
}): Promise<void> {
	const telegram = getTelegram();
	const existing = await findMember(input.from.id);

	if (!input.argument) {
		await telegram.sendMessage({
			chatId: input.chatId,
			text: existing
				? `You are linked to <b>${escapeHtml(existing.orgName)}</b>. Tell me what to write, or tap a button.`
				: "Welcome. This chat is not linked to a workspace yet — open the invite link your admin sent you.",
			// The keyboard is chat-level and sticks around; sending it here means
			// nobody has to discover a command to get started.
			...(existing ? { replyMarkup: MAIN_KEYBOARD } : {}),
		});
		return;
	}

	const result = await verifyInviteToken(input.argument, inviteSecret());

	if (!result.ok) {
		const reason =
			result.reason === "expired"
				? "That invite has expired. Ask your admin for a fresh link."
				: "That invite is not valid. Ask your admin for a fresh link.";
		await telegram.sendMessage({ chatId: input.chatId, text: reason });
		return;
	}

	const db = getDb();
	const displayName = input.from.username
		? `${input.from.first_name} (@${input.from.username})`
		: input.from.first_name;

	if (existing) {
		if (existing.orgId !== result.orgId) {
			// One Telegram account maps to one membership, enforced by a unique
			// index. Moving between workspaces is an admin action, not a re-/start.
			await telegram.sendMessage({
				chatId: input.chatId,
				text: `This account is already linked to <b>${escapeHtml(existing.orgName)}</b>. Ask an admin to move you.`,
			});
			return;
		}

		await db
			.update(orgMember)
			.set({ displayName, updatedAt: new Date() })
			.where(eq(orgMember.id, existing.memberId));
	} else {
		await db.insert(orgMember).values({
			orgId: result.orgId,
			telegramUserId: String(input.from.id),
			displayName,
			role: "member",
		});
	}

	const [org] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, result.orgId))
		.limit(1);

	await telegram.sendMessage({
		chatId: input.chatId,
		text: `Linked to <b>${escapeHtml(org?.name ?? "your workspace")}</b>. Tell me what to write, or tap a button below.`,
		replyMarkup: MAIN_KEYBOARD,
	});
}

/**
 * Approve / Reject on a draft.
 *
 * The outcome is written to `content_items` and is the training signal the
 * agents read back later, so it records who decided and when — not just the
 * new status.
 */
async function handleCallback(query: {
	id: string;
	from: { id: number };
	message?: { chat: { id: number }; message_id: number };
	data?: string;
}): Promise<void> {
	const telegram = getTelegram();
	const parsed = parseCallbackData(query.data);

	if (!parsed || !query.message) {
		await acknowledge(query.id, "That button is no longer valid.");
		return;
	}

	const member = await findMember(query.from.id);

	if (!member) {
		await acknowledge(query.id, "This chat is not linked to a workspace.");
		return;
	}

	// Deciding and refining are different rights. The role check used to sit
	// here, before the action was known, which would have made the refine
	// buttons unusable for exactly the role that is allowed to draft.
	if (member.role === "member") {
		await acknowledge(
			query.id,
			"Only an approver or owner can change or decide on drafts.",
		);
		return;
	}

	const db = getDb();

	// Scoped by org as well as id: a callback payload is client-supplied, and
	// without the org filter one workspace could act on another's draft.
	const [item] = await db
		.select({ id: contentItem.id, body: contentItem.body })
		.from(contentItem)
		.where(
			and(eq(contentItem.id, parsed.id), eq(contentItem.orgId, member.orgId)),
		)
		.limit(1);

	if (!item) {
		await acknowledge(query.id, "That draft is gone.");
		return;
	}

	const action = parsed.action;

	if (action === "photo_original" || action === "photo_polished") {
		const choice = action === "photo_original" ? "original" : "polished";

		const outcome = await choosePhoto({
			orgId: member.orgId,
			chatId: query.message.chat.id,
			messageId: query.message.message_id,
			itemId: item.id,
			choice,
		}).catch((error: unknown) => {
			console.error("photo swap failed", error);
			return "failed" as const;
		});

		if (outcome === "failed") {
			await acknowledge(query.id, "Could not swap the photo. Try again.");
			return;
		}

		await acknowledge(
			query.id,
			outcome === "ok"
				? choice === "original"
					? "Using the original"
					: "Using the polished one"
				: outcome === "published"
					? "Already posted — too late to swap."
					: "That photo is gone.",
		);
		return;
	}

	if (isRefinement(action)) {
		await acknowledge(query.id);

		const outcome = await refineDraft({
			orgId: member.orgId,
			chatId: query.message.chat.id,
			messageId: query.message.message_id,
			itemId: parsed.id,
			instruction: action,
		});

		await reportRefineOutcome(query.message.chat.id, outcome);
		return;
	}

	if (parsed.action === "edit") {
		await acknowledge(query.id);
		await promptForEdit({
			chatId: query.message.chat.id,
			ref: formatRef(item.id),
		});
		return;
	}

	const status = parsed.action === "approve" ? "approved" : "rejected";

	// Only an undecided draft can be decided. Two fast taps, or a decision
	// landing while a refinement is in flight, would otherwise both write.
	const [decided] = await db
		.update(contentItem)
		.set({
			status,
			reviewedBy: member.memberId,
			reviewedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(and(eq(contentItem.id, item.id), eq(contentItem.status, "draft")))
		.returning({ id: contentItem.id });

	if (!decided) {
		await acknowledge(query.id, "That one was already decided.");
		return;
	}

	await acknowledge(query.id, status === "approved" ? "Approved" : "Rejected");

	// Drop the buttons so the decision cannot be double-submitted.
	await telegram.editMessageText({
		chatId: query.message.chat.id,
		messageId: query.message.message_id,
		text: truncateForTelegram(
			`${escapeHtml(item.body)}\n\n— <i>${status} by ${escapeHtml(member.displayName)}</i>`,
		),
	});

	if (status === "rejected") {
		await promptForReason({
			chatId: query.message.chat.id,
			ref: formatRef(item.id, "reason"),
		});
	}
}

/** `/brain` and the "What you know" button share this. */
async function describeBrainFor(member: Member, chatId: number): Promise<void> {
	const [profile] = await getDb()
		.select({ name: brandProfile.name, summary: brandProfile.summary })
		.from(brandProfile)
		.where(eq(brandProfile.orgId, member.orgId))
		.limit(1);

	await describeBrain({
		orgId: member.orgId,
		chatId,
		brandName: profile?.name ?? member.orgName,
		hasProfile: Boolean(profile?.summary),
	});
}

/** `/plan` and the "This week" button share this. */
async function runPlanFor(member: Member, chatId: number): Promise<void> {
	if (member.role === "member") {
		await tell(
			chatId,
			"Only an owner or approver can ask for the week's plan.",
		);
		return;
	}

	await tell(chatId, "Planning your week — this takes a moment.");

	// Forced: a human asking should not be refused because the scheduler
	// already ran on Monday.
	const outcome = await runWeeklyPlan({ orgId: member.orgId, force: true });

	if (outcome.status === "skipped") {
		await tell(
			chatId,
			`I could not plan the week: ${escapeHtml(outcome.reason)}`,
		);
	}
}

/**
 * The "Write a post" button carries no argument, so ask for one.
 *
 * `force_reply` opens the composer pointed at this message; the reply is an
 * ordinary brief and falls through to the prose path.
 */
async function promptForBrief(chatId: number): Promise<void> {
	await getTelegram().sendMessage({
		chatId,
		text: "What should it be about?",
		replyMarkup: {
			force_reply: true,
			input_field_placeholder: "We are hiring two camera operators…",
		},
	});
}

/** Turns a refine result into something worth reading. */
async function reportRefineOutcome(
	chatId: number,
	outcome: Awaited<ReturnType<typeof refineDraft>>,
): Promise<void> {
	switch (outcome.status) {
		case "done":
			return;
		case "gone":
			await tell(chatId, "I cannot find that draft any more.");
			return;
		case "decided":
			await tell(chatId, "That one was already decided, so I left it alone.");
			return;
		case "failed":
			await tell(
				chatId,
				`I could not rewrite that: ${escapeHtml(outcome.reason)}`,
			);
			return;
	}
}
