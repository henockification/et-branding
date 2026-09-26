/**
 * Telegram's `secret_token` accepts only `A-Za-z0-9_-`, 1–256 characters.
 *
 * `BETTER_AUTH_SECRET` is base64, which contains `+`, `/` and `=` — handing it
 * over raw makes setWebhook fail with "secret token contains illegal
 * characters". So any secret is mapped into the allowed alphabet here, by the
 * same pure function on both sides: the setup script that registers the
 * webhook, and the handler that verifies each update. If these two ever
 * disagree, every real update is rejected as a forgery.
 */

const MAX_LENGTH = 256;

export function toTelegramSecret(value: string): string {
	const mapped = value
		// base64 → base64url, which is already inside the allowed alphabet.
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "")
		// Anything still outside the alphabet (a passphrase, say) becomes "_".
		.replace(/[^A-Za-z0-9_-]/g, "_")
		.slice(0, MAX_LENGTH);

	if (!mapped) {
		throw new Error("Webhook secret is empty after normalisation.");
	}

	return mapped;
}
