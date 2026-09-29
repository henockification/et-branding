// The Workers runtime's own bindings. Server-only: this module is never
// imported by a component, so the client bundle never sees this import.
import { env as workerEnv } from "cloudflare:workers";
import {
	and,
	eq,
	getDb,
	gt,
	isNull,
	organization,
	orgInvite,
	orgMember,
	sql,
	user,
} from "@et/db";
import { workspaceInviteEmail } from "@et/email";
import { resolveEmailSender } from "#/server/email";
import { fail } from "#/server/errors";
import { hashToken } from "#/server/sign-up-policy";

/**
 * Invites and seats: the plain server helpers behind both the owners' People
 * screen and the admin console. Each caller decides whether the person asking
 * may invite at all; nothing here checks who is asking.
 */

/** Long enough to reach someone over a weekend; short enough that a forgotten link dies. */
export const INVITE_TTL_DAYS = 7;

export const ROLES = ["owner", "approver", "member"] as const;
type Role = (typeof ROLES)[number];

/** 32 random bytes, base64url. Unguessable, and short enough to paste. */
function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function appUrl(): string {
	const base = process.env.BETTER_AUTH_URL;
	if (!base) throw new Error("BETTER_AUTH_URL is not set.");
	return base.replace(/\/+$/, "");
}

export function openInviteFilter(orgId: string) {
	return and(
		eq(orgInvite.orgId, orgId),
		isNull(orgInvite.acceptedAt),
		isNull(orgInvite.revokedAt),
		gt(orgInvite.expiresAt, new Date()),
	);
}

/**
 * How full a workspace is. Open invites count as seats: otherwise an owner
 * could hand out ten links against a limit of three and every one would work.
 */
export async function seatUsage(orgId: string): Promise<{
	used: number;
	limit: number | null;
	teamInvitesEnabled: boolean;
}> {
	const db = getDb();

	const [org] = await db
		.select({
			seatLimit: organization.seatLimit,
			teamInvitesEnabled: organization.teamInvitesEnabled,
			members: sql<number>`(select count(*)::int from ${orgMember} where ${orgMember.orgId} = ${orgId})`,
		})
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);

	const [{ invites }] = await db
		.select({ invites: sql<number>`count(*)::int` })
		.from(orgInvite)
		.where(openInviteFilter(orgId));

	return {
		used: (org?.members ?? 0) + invites,
		limit: org?.seatLimit ?? null,
		teamInvitesEnabled: org?.teamInvitesEnabled ?? false,
	};
}

/**
 * Makes an invite and, when email is configured, sends it.
 *
 * The link is returned once and never stored — only its hash is. Shared by the
 * owners' People screen and the admin console, which decide separately
 * whether the caller may invite at all.
 */
export async function issueInvite(input: {
	orgId: string;
	email: string;
	role: Role;
	/** Null when the platform admin sends it without being a member. */
	invitedBy: string | null;
}): Promise<{ url: string; emailed: boolean; expiresInDays: number }> {
	const db = getDb();
	const email = input.email.trim().toLowerCase();

	const [org] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, input.orgId))
		.limit(1);
	if (!org) fail("Not found.", 404);

	const [existing] = await db
		.select({ id: orgMember.id })
		.from(orgMember)
		.innerJoin(user, eq(user.id, orgMember.userId))
		.where(
			and(
				eq(orgMember.orgId, input.orgId),
				sql`lower(${user.email}) = ${email}`,
			),
		)
		.limit(1);
	if (existing) {
		fail(`${email} is already in this workspace.`, 409);
	}

	const token = newToken();
	const expiresAt = new Date(
		Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
	);

	// One live invite per address per workspace: a re-invite replaces the last
	// one, so an old link someone forwarded stops working.
	await db.batch([
		db
			.update(orgInvite)
			.set({ revokedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(orgInvite.orgId, input.orgId),
					eq(orgInvite.email, email),
					isNull(orgInvite.acceptedAt),
					isNull(orgInvite.revokedAt),
				),
			),
		db.insert(orgInvite).values({
			orgId: input.orgId,
			email,
			role: input.role,
			tokenHash: await hashToken(token),
			invitedBy: input.invitedBy,
			expiresAt,
		}),
	]);

	const url = `${appUrl()}/invite/${token}`;

	// Only claim it was emailed when a real sender exists; the console sender
	// "succeeds" without anything leaving the machine.
	const sender = resolveEmailSender(workerEnv);
	let emailed = false;
	if (sender.kind !== "console") {
		try {
			await sender.send(
				workspaceInviteEmail({
					to: email,
					url,
					workspaceName: org.name,
					role: input.role,
					expiresInDays: INVITE_TTL_DAYS,
				}),
			);
			emailed = true;
		} catch (error) {
			console.error("invite email failed", error);
		}
	}

	return { url, emailed, expiresInDays: INVITE_TTL_DAYS };
}

export async function withdrawInvite(orgId: string, inviteId: string) {
	await getDb()
		.update(orgInvite)
		.set({ revokedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(orgInvite.id, inviteId),
				eq(orgInvite.orgId, orgId),
				isNull(orgInvite.acceptedAt),
			),
		);
}
