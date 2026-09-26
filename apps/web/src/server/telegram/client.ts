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
