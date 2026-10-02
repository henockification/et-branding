import { verifyVideoWebhook, webhookJobId } from "@et/agents";
import { createFileRoute } from "@tanstack/react-router";
import { advanceByExternalId } from "#/server/marketing/pipeline";
import { deferWork } from "#/server/request-context";

/**
 * OpenRouter reports finished video jobs here (the `callback_url` each job is
 * submitted with).
 *
 * The signature is checked against the raw body before anything else; the
 * URL is public. The payload is then used only for the job id — the pipeline
 * re-reads the job from the API, so a forged or stale body cannot mark
 * anything done.
 *
 * Answers 200 for anything signed, including job ids we do not know: a
 * non-200 only earns retries.
 */
export const Route = createFileRoute("/api/marketing/openrouter-webhook")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const rawBody = await request.text();
				const valid = await verifyVideoWebhook({
					rawBody,
					header: request.headers.get("x-openrouter-signature"),
					secret: process.env.OPENROUTER_WEBHOOK_SECRET,
				});
				if (!valid) return new Response("Forbidden", { status: 403 });

				let payload: unknown;
				try {
					payload = JSON.parse(rawBody);
				} catch {
					return new Response("Bad Request", { status: 400 });
				}

				const id = webhookJobId(payload);
				if (!id) return new Response("ok");

				// Copying a few megabytes of video into R2 takes a moment; answer
				// first. Well inside the ~30s deferred work gets.
				const work = advanceByExternalId(id).catch((error) => {
					console.error(`openrouter webhook: ${id} failed`, error);
				});
				if (!deferWork(work)) await work;

				return new Response("ok");
			},
			GET: async () => new Response("Method Not Allowed", { status: 405 }),
		},
	},
});
