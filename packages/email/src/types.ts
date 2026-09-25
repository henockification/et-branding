export type EmailMessage = {
	to: string;
	subject: string;
	/** Always send both: some clients show only text, and it helps spam scores. */
	html: string;
	text: string;
};

export interface EmailSender {
	readonly kind: "cloudflare" | "console";
	send(message: EmailMessage): Promise<void>;
}
