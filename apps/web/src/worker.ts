import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import { pollStaleGenerations } from "#/server/marketing/pipeline";
import { runWithExecutionContext } from "#/server/request-context";
import { runScheduledPlans } from "#/server/scheduled";

/** Must match `triggers.crons` in wrangler.jsonc. */
const WEEKLY_PLAN_CRON = "0 6 * * 1";
const PROMO_POLL_CRON = "*/5 * * * *";

/**
 * The Worker entry.
 *
 * TanStack Start ships its own entry that exports only `fetch`, but Cloudflare
 * delivers cron triggers to `scheduled` — so the app's handler is composed here
 * instead, rather than losing scheduling or running a second Worker for it.
 */
const handler = createStartHandler(defaultStreamHandler);

export default {
	/**
	 * Wrapped so route handlers can reach `ctx.waitUntil` — Start passes only the
	 * request through, and a Telegram webhook needs to answer before it works.
	 */
	fetch(
		request: Request,
		env: unknown,
		ctx: { waitUntil(promise: Promise<unknown>): void },
	): Response | Promise<Response> {
		return runWithExecutionContext(ctx, () =>
			(handler as (r: Request, e: unknown, c: unknown) => Promise<Response>)(
				request,
				env,
				ctx,
			),
		);
	},
	/**
	 * Cron, dispatched on which trigger fired. `waitUntil` keeps the isolate
	 * alive for the whole run: planning several organizations, or copying
	 * finished videos into R2, takes longer than a request would normally live.
	 */
	async scheduled(
		controller: { cron: string; scheduledTime: number },
		_env: unknown,
		ctx: { waitUntil(promise: Promise<unknown>): void },
	): Promise<void> {
		const at = new Date(controller.scheduledTime);
		if (controller.cron === WEEKLY_PLAN_CRON) {
			ctx.waitUntil(runScheduledPlans(at));
		} else if (controller.cron === PROMO_POLL_CRON) {
			ctx.waitUntil(pollStaleGenerations(at));
		} else {
			console.warn(`scheduled: no job for cron "${controller.cron}"`);
		}
	},
};
