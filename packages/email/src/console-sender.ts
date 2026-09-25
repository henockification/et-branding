import type { EmailMessage, EmailSender } from "./types.ts";

/**
 * Development fallback: prints the message instead of sending it.
 *
 * Password reset is unusable without a sender, and Cloudflare Email Service
 * needs an onboarded domain that a local machine does not have. Printing the
 * link keeps the whole flow testable offline — and makes it obvious in the log
 * that nothing actually left the building.
 */
export function createConsoleSender(): EmailSender {
	return {
		kind: "console",
		async send(message: EmailMessage) {
			console.warn(
				[
					"",
					"┌─ email NOT sent (no sending domain configured) ─────────────",
					`│ to:      ${message.to}`,
					`│ subject: ${message.subject}`,
					"│",
					...message.text.split("\n").map((line) => `│ ${line}`),
					"└─────────────────────────────────────────────────────────────",
					"",
				].join("\n"),
			);
		},
	};
}
