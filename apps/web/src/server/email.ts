import { BRANDING } from "@et/core";
import {
	createCloudflareSender,
	createConsoleSender,
	type EmailSender,
	type SendEmailBinding,
} from "@et/email";

/**
 * Pick a sender for this environment.
 *
 * Cloudflare Email Service only accepts a `from` on a domain onboarded with
 * `wrangler email sending enable`, so it is used when both the binding and
 * EMAIL_FROM are present. Otherwise mail is printed to the log — the flow
 * still works end to end, it just does not leave the machine.
 */
export function resolveEmailSender(env: unknown): EmailSender {
	const from = process.env.EMAIL_FROM;
	const binding = emailBinding(env);

	if (!from || !binding) {
		return createConsoleSender();
	}

	return createCloudflareSender({
		binding,
		from,
		fromName: BRANDING.name,
		...(process.env.EMAIL_REPLY_TO
			? { replyTo: process.env.EMAIL_REPLY_TO }
			: {}),
	});
}

/**
 * The runtime's `SendEmail` binding is typed against Cloudflare's own message
 * shape, which is structurally close but not identical to what `@et/email`
 * declares. Narrowed by hand here so the cast happens once, at the boundary.
 */
function emailBinding(env: unknown): SendEmailBinding | undefined {
	if (typeof env !== "object" || env === null) return undefined;

	const candidate = (env as { EMAIL?: unknown }).EMAIL;
	if (
		typeof candidate !== "object" ||
		candidate === null ||
		typeof (candidate as { send?: unknown }).send !== "function"
	) {
		return undefined;
	}

	return candidate as SendEmailBinding;
}
