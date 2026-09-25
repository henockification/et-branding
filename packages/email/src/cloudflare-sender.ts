import type { EmailMessage, EmailSender } from "./types.ts";

/**
 * The shape of the Workers `send_email` binding this sender needs. Declared
 * structurally so the package does not depend on Workers types — the app
 * passes in the real binding, whose generated type satisfies this.
 */
export type SendEmailBinding = {
	send(message: {
		to: string | string[];
		from: { email: string; name?: string };
		replyTo?: string;
		subject: string;
		html: string;
		text: string;
	}): Promise<unknown>;
};

export type CloudflareSenderConfig = {
	binding: SendEmailBinding;
	/** Must be on a domain onboarded with `wrangler email sending enable`. */
	from: string;
	fromName: string;
	replyTo?: string;
};

/**
 * Cloudflare Email Service via the Workers binding — no API key, since the
 * binding carries the account's own authority.
 *
 * Only works once the `from` domain is onboarded onto Email Sending; until
 * then the console sender stands in.
 */
export function createCloudflareSender(
	config: CloudflareSenderConfig,
): EmailSender {
	return {
		kind: "cloudflare",
		async send(message: EmailMessage) {
			await config.binding.send({
				to: message.to,
				from: { email: config.from, name: config.fromName },
				...(config.replyTo ? { replyTo: config.replyTo } : {}),
				subject: message.subject,
				html: message.html,
				text: message.text,
			});
		},
	};
}
