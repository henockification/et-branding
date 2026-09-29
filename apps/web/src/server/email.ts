import { BRANDING } from "@et/core";
import {
	createCloudflareSender,
	createConsoleSender,
	createResendSender,
	type EmailSender,
	type SendEmailBinding,
} from "@et/email";

/**
 * Pick a sender for this environment.
 *
 * Resend when its key is set, then Cloudflare Email Service when its binding
 * is usable, and otherwise the log — so password reset and invites still work
 * end to end on a machine that cannot send, and say plainly that nothing left.
 *
 * Every real sender needs EMAIL_FROM on a domain it has verified.
 */
export function resolveEmailSender(env: unknown): EmailSender {
	const from = process.env.EMAIL_FROM;
	if (!from) return createConsoleSender();

	const replyTo = process.env.EMAIL_REPLY_TO
		? { replyTo: process.env.EMAIL_REPLY_TO }
		: {};

	const resendKey = process.env.RESEND_API_KEY;
	if (resendKey) {
		return createResendSender({
			apiKey: resendKey,
			from,
			fromName: BRANDING.name,
			...replyTo,
		});
	}

	const binding = emailBinding(env);
	if (binding) {
		return createCloudflareSender({
			binding,
			from,
			fromName: BRANDING.name,
			...replyTo,
		});
	}

	return createConsoleSender();
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
