import type { EmailMessage, EmailSender } from "./types.ts";

export type ResendSenderConfig = {
	apiKey: string;
	/** Must be on a domain verified in Resend. */
	from: string;
	fromName: string;
	replyTo?: string;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend, over its HTTP API.
 *
 * Plain `fetch` rather than the SDK: one endpoint, and nothing to vet for the
 * Workers runtime. A send-only API key is enough — and is all this should be
 * given.
 */
export function createResendSender(config: ResendSenderConfig): EmailSender {
	return {
		kind: "resend",
		async send(message: EmailMessage) {
			const response = await fetch(RESEND_ENDPOINT, {
				method: "POST",
				headers: {
					authorization: `Bearer ${config.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					from: `${config.fromName} <${config.from}>`,
					to: [message.to],
					subject: message.subject,
					html: message.html,
					text: message.text,
					...(config.replyTo ? { reply_to: config.replyTo } : {}),
				}),
			});

			if (!response.ok) {
				// Resend explains itself in the body — an unverified domain, a bad
				// key — and that is the part worth having in the log.
				const detail = await response.text().catch(() => "");
				throw new Error(
					`Resend rejected the email (HTTP ${response.status}): ${detail.slice(0, 300)}`,
				);
			}
		},
	};
}
