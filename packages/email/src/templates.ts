import { BRANDING } from "@et/core";
import type { EmailMessage } from "./types.ts";

/**
 * Transactional templates.
 *
 * Deliberately plain HTML with inline styles: mail clients strip stylesheets,
 * and a reset mail that renders as a wall of unstyled text still has to be
 * usable. The brand colour is inlined rather than pulled from a token because
 * CSS variables do not survive the trip either.
 */
const BRAND = BRANDING.themeColor;

function layout(
	heading: string,
	body: string,
	action?: { href: string; label: string },
): string {
	return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f4fd;font-family:Inter,system-ui,sans-serif;color:#160935">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border:1px solid #ddd3f5;border-radius:12px;padding:24px">
<tr><td>
<p style="margin:0 0 16px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND}">${BRANDING.name}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:#160935">${heading}</h1>
<div style="margin:0 0 24px;font-size:15px;line-height:23px;color:#5e5478">${body}</div>
${
	action
		? `<a href="${action.href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:12px;font-size:15px;font-weight:600">${action.label}</a>
<p style="margin:24px 0 0;font-size:13px;line-height:18px;color:#5e5478">If the button does not work, paste this into your browser:<br><span style="color:${BRAND};word-break:break-all">${action.href}</span></p>`
		: ""
}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

export function passwordResetEmail(options: {
	to: string;
	url: string;
	expiresInMinutes: number;
}): EmailMessage {
	const { to, url, expiresInMinutes } = options;

	return {
		to,
		subject: `Reset your ${BRANDING.name} password`,
		html: layout(
			"Reset your password",
			`<p style="margin:0">Someone asked to reset the password for this account. The link is good for ${expiresInMinutes} minutes.</p>
<p style="margin:16px 0 0">If it wasn't you, ignore this email — nothing changes until the link is used.</p>`,
			{ href: url, label: "Choose a new password" },
		),
		text: [
			"Reset your password",
			"",
			`Someone asked to reset the password for this account. The link is good for ${expiresInMinutes} minutes.`,
			"",
			url,
			"",
			"If it wasn't you, ignore this email — nothing changes until the link is used.",
		].join("\n"),
	};
}
