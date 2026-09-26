import { getDb, telegramUpdate } from "@et/db";
import type { TelegramUpdate } from "@et/telegram";
import { createFileRoute } from "@tanstack/react-router";
import { deferWork } from "#/server/request-context";
import { webhookSecret } from "#/server/telegram/client";
import { handleUpdate } from "#/server/telegram/router";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** Constant-time compare so the header check leaks nothing through timing. */
function secretMatches(provided: string | null, expected: string): boolean {
	if (!provided || provided.length !== expected.length) return false;

	let diff = 0;
	for (let i = 0; i < expected.length; i += 1) {
		diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * Telegram posts every update here.
 *
 * The URL is public, so the shared secret set with `setWebhook` is the only
 * thing separating real updates from anyone who guesses the path.
 *
 * Always answers 200 once the secret checks out: a non-200 makes Telegram
 * retry, and retrying a message that triggered a bug just repeats the bug.
 */
export const Route = createFileRoute("/api/telegram/webhook")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (
					!secretMatches(request.headers.get(SECRET_HEADER), webhookSecret())
				) {
					return new Response("Forbidden", { status: 403 });
				}

				let update: TelegramUpdate;
				try {
					update = (await request.json()) as TelegramUpdate;
				} catch {
					return new Response("Bad Request", { status: 400 });
				}

				// Claim the update before answering. A retry that arrives while the
				// first is still in flight must lose the race here, not later —
				// which is why this is not deferred with the rest of the work.
				const [claimed] = await getDb()
					.insert(telegramUpdate)
					.values({ updateId: update.update_id })
					.onConflictDoNothing()
					.returning({ updateId: telegramUpdate.updateId });

				if (!claimed) {
					// Already handled. Telegram does not document its retry rules, so
					// correctness cannot depend on answering quickly enough.
					return new Response("ok");
				}

				// Answer first, work after. Generating a draft takes seconds and a
				// weekly plan tens of seconds; holding the webhook open that long
				// invites Telegram to retry and deliver the same update twice.
				// One promise, started once. Passing `handleUpdate(update)` straight
				// into the call and awaiting it again in the fallback would run the
				// whole handler twice.
				const work = handleUpdate(update);
				if (!deferWork(work)) {
					// No execution context (local Node, tests): do it inline rather
					// than dropping the update.
					await work;
				}

				return new Response("ok");
			},
			// Telegram only ever POSTs here. Without this, a GET would fall through
			// and render the whole app at an API path.
			GET: async () => new Response("Method Not Allowed", { status: 405 }),
		},
	},
});
