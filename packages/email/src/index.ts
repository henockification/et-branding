export {
	type CloudflareSenderConfig,
	createCloudflareSender,
	type SendEmailBinding,
} from "./cloudflare-sender.ts";
export { createConsoleSender } from "./console-sender.ts";
export {
	createResendSender,
	type ResendSenderConfig,
} from "./resend-sender.ts";
export { passwordResetEmail, workspaceInviteEmail } from "./templates.ts";
export type { EmailMessage, EmailSender } from "./types.ts";
