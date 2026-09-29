import { and, getDb, gt, isNull, orgInvite, sql } from "@et/db";

/**
 * Who may have an account, and who runs the platform.
 *
 * Kept free of any import from `auth.ts`: the auth instance calls into this
 * module on every sign-up, so importing back would make a cycle.
 */

/**
 * Product owners: every workspace is theirs to see and manage, and only they
 * create workspaces and invite clients.
 *
 * An environment list rather than a table so there is no admin screen to build
 * or to secure — adding someone is one `wrangler secret put`.
 */
export function platformAdminEmails(): ReadonlySet<string> {
	return new Set(
		(process.env.PLATFORM_ADMIN_EMAILS ?? "")
			.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean),
	);
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
	return (
		Boolean(email) && platformAdminEmails().has(String(email).toLowerCase())
	);
}

/** SHA-256, hex. Invite tokens are stored only in this form. */
export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/** True when an unused, unrevoked, unexpired invite exists for the address. */
export async function hasOpenInvite(email: string): Promise<boolean> {
	const [open] = await getDb()
		.select({ id: orgInvite.id })
		.from(orgInvite)
		.where(
			and(
				sql`lower(${orgInvite.email}) = ${email.toLowerCase()}`,
				isNull(orgInvite.acceptedAt),
				isNull(orgInvite.revokedAt),
				gt(orgInvite.expiresAt, new Date()),
			),
		)
		.limit(1);

	return Boolean(open);
}

/**
 * Sign-up is by invitation. A platform admin can always create their own
 * account, so a fresh deployment is never locked out of itself.
 */
export async function canSignUp(email: string): Promise<boolean> {
	return isPlatformAdmin(email) || (await hasOpenInvite(email));
}
