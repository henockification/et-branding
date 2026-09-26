import {
	and,
	brandProfile,
	contentItem,
	eq,
	getDb,
	organization,
	orgMember,
} from "@et/db";
import {
	escapeHtml,
	parseCallbackData,
	type TelegramUpdate,
	truncateForTelegram,
	verifyInviteToken,
} from "@et/telegram";
import { getTelegram, inviteSecret } from "#/server/telegram/client";
import { handleDraftCommand } from "#/server/telegram/draft";

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
	"<b>What I can do</b>",
	"",
	"/draft &lt;what it is about&gt; — write a post for review",
	"/whoami — which workspace you are linked to",
	"/help — this message",
	"",
	"Nothing I write is published. Every draft waits for a human to approve, edit or reject it.",
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
		if (!message?.text || !message.from || message.from.is_bot) return;

		await handleMessage({
			chatId: message.chat.id,
			from: message.from,
			text: message.text.trim(),
		});
	} catch (error) {
		console.error("telegram update failed", error);
	}
}

async function handleMessage(input: {
	chatId: number;
	from: { id: number; first_name: string; username?: string };
	text: string;
}): Promise<void> {
	const telegram = getTelegram();
	const [command, ...rest] = input.text.split(/\s+/);
	const argument = rest.join(" ");

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

	switch (command) {
		case "/draft":
			await handleDraftCommand({
				orgId: member.orgId,
				chatId: input.chatId,
				brief: argument,
			});
			return;

		case "/help":
			await telegram.sendMessage({ chatId: input.chatId, text: HELP });
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
			await telegram.sendMessage({
				chatId: input.chatId,
				text: `I do not know that one yet. ${HELP}`,
			});
	}
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
				? `You are linked to <b>${escapeHtml(existing.orgName)}</b>. Send /help to see what I can do.`
				: "Welcome. This chat is not linked to a workspace yet — open the invite link your admin sent you.",
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
		text: `Linked to <b>${escapeHtml(org?.name ?? "your workspace")}</b>. Send /help to see what I can do.`,
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
		await telegram.answerCallbackQuery({
			callbackQueryId: query.id,
			text: "That button is no longer valid.",
		});
		return;
	}

	const member = await findMember(query.from.id);

	if (!member || member.role === "member") {
		await telegram.answerCallbackQuery({
			callbackQueryId: query.id,
			text: "Only an approver or owner can decide on drafts.",
		});
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
		await telegram.answerCallbackQuery({
			callbackQueryId: query.id,
			text: "That draft is gone.",
		});
		return;
	}

	if (parsed.action === "edit") {
		await telegram.answerCallbackQuery({
			callbackQueryId: query.id,
			text: "Send the corrected version as a reply — coming next.",
		});
		return;
	}

	const status = parsed.action === "approve" ? "approved" : "rejected";

	await db
		.update(contentItem)
		.set({
			status,
			reviewedBy: member.memberId,
			reviewedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(contentItem.id, item.id));

	await telegram.answerCallbackQuery({
		callbackQueryId: query.id,
		text: status === "approved" ? "Approved" : "Rejected",
	});

	// Drop the buttons so the decision cannot be double-submitted.
	await telegram.editMessageText({
		chatId: query.message.chat.id,
		messageId: query.message.message_id,
		text: truncateForTelegram(
			`${escapeHtml(item.body)}\n\n— <i>${status} by ${escapeHtml(member.displayName)}</i>`,
		),
	});
}
