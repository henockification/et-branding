/**
 * Points Telegram at a deployment. Run once per environment, and again
 * whenever the public URL changes.
 *
 *   pnpm --filter @et/web telegram:webhook https://your-deployment-url
 *
 * The secret Telegram echoes on every update comes from TELEGRAM_WEBHOOK_SECRET
 * (or BETTER_AUTH_SECRET), normalised by the same function the webhook handler
 * uses — importing it rather than re-implementing it is the point: if the two
 * ever disagree, every real update is rejected as a forgery.
 */
import { toTelegramSecret } from "../../../packages/telegram/src/index.ts";

const [, , baseUrl] = process.argv;

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
	console.error("Usage: telegram:webhook https://your-deployment-url");
	console.error("Telegram requires HTTPS; localhost will not work.");
	process.exit(1);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const rawSecret =
	process.env.TELEGRAM_WEBHOOK_SECRET ?? process.env.BETTER_AUTH_SECRET;

if (!token) {
	console.error("TELEGRAM_BOT_TOKEN is not set. Get one from @BotFather.");
	process.exit(1);
}
if (!rawSecret) {
	console.error(
		"Neither TELEGRAM_WEBHOOK_SECRET nor BETTER_AUTH_SECRET is set.",
	);
	process.exit(1);
}

const secret = toTelegramSecret(rawSecret);
const url = `${baseUrl.replace(/\/+$/, "")}/api/telegram/webhook`;

async function call<T>(
	method: string,
	payload: Record<string, unknown> = {},
): Promise<T> {
	const response = await fetch(
		`https://api.telegram.org/bot${token}/${method}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		},
	);
	const body = (await response.json()) as {
		ok: boolean;
		result?: T;
		description?: string;
	};
	if (!body.ok) throw new Error(`${method}: ${body.description}`);
	return body.result as T;
}

const me = await call<{ username: string }>("getMe");
console.log(`Bot: @${me.username}`);

await call("setWebhook", {
	url,
	secret_token: secret,
	allowed_updates: ["message", "callback_query"],
	drop_pending_updates: true,
});
console.log(`Webhook set: ${url}`);

const info = await call<{
	pending_update_count: number;
	last_error_message?: string;
}>("getWebhookInfo");
console.log(`Pending updates: ${info.pending_update_count}`);
if (info.last_error_message) {
	console.log(`Last error: ${info.last_error_message}`);
}
console.log(
	`\nTELEGRAM_BOT_USERNAME should be "${me.username}" for one-tap invite links.`,
);
