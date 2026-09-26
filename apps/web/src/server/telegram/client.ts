import { TelegramClient, toTelegramSecret } from "@et/telegram";

let cached: TelegramClient | undefined;

/** Built once per isolate; throws with the variable name if unconfigured. */
export function getTelegram(): TelegramClient {
	if (!cached) {
		const token = process.env.TELEGRAM_BOT_TOKEN;
		if (!token) {
			throw new Error(
				"TELEGRAM_BOT_TOKEN is not set — see apps/web/.dev.vars.example.",
			);
		}
		cached = new TelegramClient(token);
	}
	return cached;
}

/**
 * The shared secret Telegram echoes on every update.
 *
 * Falls back to the auth secret so the bot is never accidentally left
 * unauthenticated: a webhook URL is public, and without this check anyone who
 * guesses it can impersonate Telegram.
 */
export function webhookSecret(): string {
	const secret =
		process.env.TELEGRAM_WEBHOOK_SECRET ?? process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error("TELEGRAM_WEBHOOK_SECRET is not set.");
	}
	// Normalised, because Telegram will only ever send the normalised form.
	return toTelegramSecret(secret);
}

/** Signs invite deep links. Same secret family as the webhook check. */
export function inviteSecret(): string {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error("BETTER_AUTH_SECRET is not set.");
	}
	return secret;
}

/**
 * A message whose delivery does not matter enough to fail over.
 *
 * Acknowledgements, progress notes and error notices all go through here.
 * Awaiting `sendMessage` directly for these has bitten twice: a failed courtesy
 * message threw and aborted the work it was announcing. Anything whose loss
 * would be invisible to the user belongs here; anything carrying the result
 * should be sent after the work is recorded.
 */
export async function tell(chatId: number, text: string): Promise<void> {
	try {
		await getTelegram().sendMessage({ chatId, text });
	} catch (error) {
		console.error("telegram notice failed", error);
	}
}

/**
 * Acknowledge a tapped button. Never throws.
 *
 * Telegram rejects a callback id that is stale, and the toast is decoration —
 * letting that abort the work behind the button is the same mistake as awaiting
 * a typing indicator. This is the fourth place it would have bitten.
 */
export async function acknowledge(
	callbackQueryId: string,
	text?: string,
): Promise<void> {
	try {
		await getTelegram().answerCallbackQuery({
			callbackQueryId,
			...(text ? { text } : {}),
		});
	} catch (error) {
		console.error("telegram acknowledge failed", error);
	}
}
