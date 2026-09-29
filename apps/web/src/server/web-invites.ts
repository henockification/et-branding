import {
	and,
	asc,
	desc,
	eq,
	getDb,
	isNull,
	ne,
	organization,
	orgInvite,
	orgMember,
	sql,
	user,
} from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	getViewer,
	readAccess,
	requireAccess,
	requireViewer,
} from "#/server/access";
import {
	issueInvite,
	openInviteFilter,
	ROLES,
	seatUsage,
	withdrawInvite,
} from "#/server/invite-core";
import { hashToken } from "#/server/sign-up-policy";

/**
 * Who is in a workspace, on the web and on Telegram.
 *
 * Every member sees the list. Owners also see pending invites and get the
 * controls — within the seat limit and the invite switch the platform admin
 * sets for this workspace.
 */
export const fetchPeople = createServerFn({ method: "GET" })
	.validator(z.object({ orgId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const access = await readAccess(data.orgId);
		if (!access) return { found: false } as const;

		const db = getDb();
		const canManage = access.role === "owner";

		const members = await db
			.select({
				id: orgMember.id,
				displayName: orgMember.displayName,
				role: orgMember.role,
				email: user.email,
				onTelegram: sql<boolean>`${orgMember.telegramUserId} is not null`,
			})
			.from(orgMember)
			.leftJoin(user, eq(user.id, orgMember.userId))
			.where(eq(orgMember.orgId, data.orgId))
			.orderBy(asc(orgMember.createdAt));

		const invites = canManage
			? await db
					.select({
						id: orgInvite.id,
						email: orgInvite.email,
						role: orgInvite.role,
						expiresAt: orgInvite.expiresAt,
					})
					.from(orgInvite)
					.where(openInviteFilter(data.orgId))
					.orderBy(desc(orgInvite.createdAt))
			: [];

		return {
			found: true as const,
			canManage,
			myMemberId: access.memberId,
			members,
			invites,
			seats: await seatUsage(data.orgId),
		};
	});

/** An owner inviting someone onto their own team. */
export const createWebInvite = createServerFn({ method: "POST" })
	.validator(
		z.object({
			orgId: z.string().uuid(),
			email: z.string().trim().toLowerCase().email().max(254),
			role: z.enum(ROLES),
		}),
	)
	.handler(async ({ data }) => {
		const access = await requireAccess(data.orgId, "manage");
		const seats = await seatUsage(data.orgId);

		if (!seats.teamInvitesEnabled) {
			throw new Response(
				"Team invites are turned off for this workspace. Contact your account manager.",
				{ status: 403 },
			);
		}
		if (seats.limit !== null && seats.used >= seats.limit) {
			throw new Response(
				`This workspace has used all ${seats.limit} seats. Remove someone or ask for more seats.`,
				{ status: 403 },
			);
		}

		return issueInvite({
			orgId: data.orgId,
			email: data.email,
			role: data.role,
			invitedBy: access.viewer.userId,
		});
	});

export const revokeInvite = createServerFn({ method: "POST" })
	.validator(
		z.object({ orgId: z.string().uuid(), inviteId: z.string().uuid() }),
	)
	.handler(async ({ data }) => {
		await requireAccess(data.orgId, "manage");
		await withdrawInvite(data.orgId, data.inviteId);
		return { revoked: true };
	});

/**
 * A workspace must always keep an owner: without one nobody can invite or
 * manage people, and the client would be locked out of their own team.
 */
async function assertKeepsAnOwner(orgId: string, memberId: string) {
	const [{ others }] = await getDb()
		.select({ others: sql<number>`count(*)::int` })
		.from(orgMember)
		.where(
			and(
				eq(orgMember.orgId, orgId),
				eq(orgMember.role, "owner"),
				ne(orgMember.id, memberId),
			),
		);

	if (others === 0) {
		throw new Response(
			"This is the workspace's only owner. Make someone else an owner first.",
			{ status: 409 },
		);
	}
}

/** Changes what someone may do. Applies on the web and on Telegram at once. */
export const setMemberRole = createServerFn({ method: "POST" })
	.validator(
		z.object({
			orgId: z.string().uuid(),
			memberId: z.string().uuid(),
			role: z.enum(ROLES),
		}),
	)
	.handler(async ({ data }) => {
		await requireAccess(data.orgId, "manage");
		if (data.role !== "owner") {
			await assertKeepsAnOwner(data.orgId, data.memberId);
		}

		await getDb()
			.update(orgMember)
			.set({ role: data.role, updatedAt: new Date() })
			.where(
				and(eq(orgMember.id, data.memberId), eq(orgMember.orgId, data.orgId)),
			);

		return { saved: true };
	});

/**
 * Takes someone out of a workspace — web login and Telegram both, since they
 * share the membership row. Their past decisions stay, unattributed.
 */
export const removeMember = createServerFn({ method: "POST" })
	.validator(
		z.object({ orgId: z.string().uuid(), memberId: z.string().uuid() }),
	)
	.handler(async ({ data }) => {
		await requireAccess(data.orgId, "manage");
		await assertKeepsAnOwner(data.orgId, data.memberId);

		await getDb()
			.delete(orgMember)
			.where(
				and(eq(orgMember.id, data.memberId), eq(orgMember.orgId, data.orgId)),
			);

		return { removed: true };
	});

type InviteStatus =
	| "open"
	| "accepted"
	| "revoked"
	| "expired"
	| "suspended"
	| "invalid";

async function findInvite(token: string) {
	const [invite] = await getDb()
		.select({
			id: orgInvite.id,
			orgId: orgInvite.orgId,
			orgName: organization.name,
			orgStatus: organization.status,
			email: orgInvite.email,
			role: orgInvite.role,
			expiresAt: orgInvite.expiresAt,
			acceptedAt: orgInvite.acceptedAt,
			revokedAt: orgInvite.revokedAt,
		})
		.from(orgInvite)
		.innerJoin(organization, eq(organization.id, orgInvite.orgId))
		.where(eq(orgInvite.tokenHash, await hashToken(token)))
		.limit(1);

	if (!invite) return { status: "invalid" as InviteStatus, invite: null };

	const status: InviteStatus = invite.acceptedAt
		? "accepted"
		: invite.revokedAt
			? "revoked"
			: invite.expiresAt <= new Date()
				? "expired"
				: invite.orgStatus !== "active"
					? "suspended"
					: "open";

	return { status, invite };
}

const tokenSchema = z.object({ token: z.string().min(20).max(100) });

/**
 * What the invite page shows. Public: the visitor may not have an account yet.
 * It reveals the workspace name and the invited address only to someone who
 * holds the link.
 */
export const fetchInvite = createServerFn({ method: "GET" })
	.validator(tokenSchema)
	.handler(async ({ data }) => {
		const { status, invite } = await findInvite(data.token);
		const viewer = await getViewer();

		return {
			status,
			orgName: invite?.orgName ?? null,
			email: status === "open" ? (invite?.email ?? null) : null,
			role: invite?.role ?? null,
			signedInAs: viewer?.email ?? null,
		};
	});

/**
 * Joins the signed-in account to the invite's workspace.
 *
 * The account's address must be the invited one. Otherwise a link forwarded
 * to the wrong person — or read over a shoulder — would let them in.
 */
export const acceptInvite = createServerFn({ method: "POST" })
	.validator(tokenSchema)
	.handler(async ({ data }) => {
		const viewer = await requireViewer();
		const { status, invite } = await findInvite(data.token);

		if (!invite || status !== "open") {
			throw new Response(
				status === "expired"
					? "This invite has expired. Ask for a new one."
					: status === "revoked"
						? "This invite was withdrawn. Ask for a new one."
						: status === "accepted"
							? "This invite has already been used."
							: status === "suspended"
								? "This workspace is suspended at the moment."
								: "This invite link is not valid.",
				{ status: 410 },
			);
		}

		if (invite.email.toLowerCase() !== viewer.email.toLowerCase()) {
			throw new Response(
				`This invite is for ${invite.email}, but you are signed in as ${viewer.email}. Sign out and use that address.`,
				{ status: 403 },
			);
		}

		const db = getDb();

		// Membership first, then mark the invite used: if the second write fails
		// the person is in and can simply open the link again, rather than
		// holding a spent invite and no access.
		await db
			.insert(orgMember)
			.values({
				orgId: invite.orgId,
				userId: viewer.userId,
				displayName: viewer.name || viewer.email,
				role: invite.role,
			})
			.onConflictDoUpdate({
				target: [orgMember.orgId, orgMember.userId],
				set: { role: invite.role, updatedAt: new Date() },
			});

		await db
			.update(orgInvite)
			.set({
				acceptedAt: new Date(),
				acceptedBy: viewer.userId,
				updatedAt: new Date(),
			})
			.where(and(eq(orgInvite.id, invite.id), isNull(orgInvite.acceptedAt)));

		return { orgId: invite.orgId };
	});
