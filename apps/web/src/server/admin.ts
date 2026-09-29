import {
	agentRun,
	and,
	brandProfile,
	contentItem,
	desc,
	eq,
	getDb,
	gt,
	gte,
	inArray,
	isNull,
	organization,
	orgInvite,
	orgMember,
	sql,
	user,
} from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getViewer, requireAdmin } from "#/server/access";
import { fail } from "#/server/errors";
import { issueInvite, withdrawInvite } from "#/server/invite-core";

/**
 * The platform admin's console: every workspace as an account.
 *
 * What is here is what running the business needs — who the client is, whether
 * they are paid up, how many seats they use and what their drafts cost in
 * model calls. What is not here is their content: brand profiles, drafts and
 * past posts belong to the client, and the admin sees them only in workspaces
 * they are themselves a member of.
 */

const orgIdSchema = z.object({ orgId: z.string().uuid() });

/** First day of the current month, UTC — the window usage is reported for. */
function monthStart(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Returns rather than throws for a non-admin: this feeds a page loader, where
 * an error would escape as a raw failure instead of the app's not-found page.
 */
export const fetchAdminConsole = createServerFn({ method: "GET" }).handler(
	async () => {
		const admin = await getViewer();
		if (!admin?.isAdmin) return { allowed: false as const };
		const db = getDb();
		const since = monthStart();

		const workspaces = await db
			.select({
				id: organization.id,
				name: organization.name,
				createdAt: organization.createdAt,
				status: organization.status,
				suspendedAt: organization.suspendedAt,
				suspendedReason: organization.suspendedReason,
				plan: organization.plan,
				priceMonthly: organization.priceMonthly,
				currency: organization.currency,
				paidUntil: organization.paidUntil,
				billingNote: organization.billingNote,
				seatLimit: organization.seatLimit,
				teamInvitesEnabled: organization.teamInvitesEnabled,
				hasBrand: sql<boolean>`${brandProfile.summary} is not null`,
			})
			.from(organization)
			.leftJoin(brandProfile, eq(brandProfile.orgId, organization.id))
			.orderBy(desc(organization.createdAt));

		const ids = workspaces.map((w) => w.id);
		if (ids.length === 0) {
			return {
				allowed: true as const,
				adminEmail: admin.email,
				since,
				workspaces: [],
			};
		}

		const [members, invites, drafts, spend] = await Promise.all([
			db
				.select({
					id: orgMember.id,
					orgId: orgMember.orgId,
					displayName: orgMember.displayName,
					role: orgMember.role,
					email: user.email,
					userId: orgMember.userId,
					onTelegram: sql<boolean>`${orgMember.telegramUserId} is not null`,
				})
				.from(orgMember)
				.leftJoin(user, eq(user.id, orgMember.userId))
				.where(inArray(orgMember.orgId, ids)),

			db
				.select({
					id: orgInvite.id,
					orgId: orgInvite.orgId,
					email: orgInvite.email,
					role: orgInvite.role,
					expiresAt: orgInvite.expiresAt,
				})
				.from(orgInvite)
				.where(
					and(
						inArray(orgInvite.orgId, ids),
						isNull(orgInvite.acceptedAt),
						isNull(orgInvite.revokedAt),
						gt(orgInvite.expiresAt, new Date()),
					),
				),

			// Counts only — how much the workspace is used, never what it says.
			db
				.select({
					orgId: contentItem.orgId,
					count: sql<number>`count(*)::int`,
				})
				.from(contentItem)
				.where(
					and(
						inArray(contentItem.orgId, ids),
						gte(contentItem.createdAt, since),
					),
				)
				.groupBy(contentItem.orgId),

			db
				.select({
					orgId: agentRun.orgId,
					usd: sql<string>`coalesce(sum(${agentRun.usd}), 0)::text`,
				})
				.from(agentRun)
				.where(
					and(inArray(agentRun.orgId, ids), gte(agentRun.createdAt, since)),
				)
				.groupBy(agentRun.orgId),
		]);

		const today = new Date().toISOString().slice(0, 10);

		return {
			allowed: true as const,
			adminEmail: admin.email,
			since,
			workspaces: workspaces.map((workspace) => {
				const people = members.filter((m) => m.orgId === workspace.id);
				const pending = invites.filter((i) => i.orgId === workspace.id);
				return {
					...workspace,
					/** The admin's own workspace, where they are a member like anyone else. */
					yours: people.some((m) => m.userId === admin.userId),
					members: people.map(({ userId: _userId, orgId: _orgId, ...m }) => m),
					invites: pending,
					seatsUsed: people.length + pending.length,
					draftsThisMonth:
						drafts.find((d) => d.orgId === workspace.id)?.count ?? 0,
					modelUsdThisMonth: Number(
						spend.find((s) => s.orgId === workspace.id)?.usd ?? 0,
					),
					overdue: Boolean(
						workspace.status === "active" &&
							workspace.paidUntil &&
							workspace.paidUntil < today,
					),
				};
			}),
		};
	},
);

/** Lowercase, dash-separated, with a short suffix so two "Bunna"s can coexist. */
function slugify(name: string): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);

	const suffix = Math.random().toString(36).slice(2, 8);
	return `${base || "org"}-${suffix}`;
}

/**
 * Creates a workspace, either the admin's own or a client's.
 *
 * Own: the admin becomes its owner, like any member. Client: the admin stays
 * out of it, and the client's first owner is invited — the workspace is
 * theirs from the first minute.
 */
export const createWorkspace = createServerFn({ method: "POST" })
	.validator(
		z.discriminatedUnion("kind", [
			z.object({
				kind: z.literal("own"),
				name: z.string().trim().min(1).max(80),
			}),
			z.object({
				kind: z.literal("client"),
				name: z.string().trim().min(1).max(80),
				ownerEmail: z.string().trim().toLowerCase().email().max(254),
				seatLimit: z.number().int().min(1).max(500).nullable(),
			}),
		]),
	)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();
		const db = getDb();

		const [created] = await db
			.insert(organization)
			.values({
				name: data.name,
				slug: slugify(data.name),
				...(data.kind === "client" ? { seatLimit: data.seatLimit } : {}),
			})
			.returning({ id: organization.id });

		if (!created) {
			fail("Could not create that workspace.", 500);
		}

		await db
			.insert(brandProfile)
			.values({ orgId: created.id, name: data.name });

		if (data.kind === "own") {
			await db.insert(orgMember).values({
				orgId: created.id,
				userId: admin.userId,
				displayName: admin.name || admin.email,
				role: "owner",
			});
			return { orgId: created.id, invite: null };
		}

		const invite = await issueInvite({
			orgId: created.id,
			email: data.ownerEmail,
			role: "owner",
			invitedBy: null,
		});

		return { orgId: created.id, invite };
	});

/**
 * Suspends or reactivates a workspace.
 *
 * Suspending keeps every row and only closes the door: the web app stops
 * opening it, the bot answers with the reason, and the weekly plan skips it.
 * Reactivating opens it again exactly as it was.
 */
export const setWorkspaceStatus = createServerFn({ method: "POST" })
	.validator(
		orgIdSchema.extend({
			status: z.enum(["active", "suspended"]),
			reason: z.string().trim().max(300).optional(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();

		await getDb()
			.update(organization)
			.set(
				data.status === "suspended"
					? {
							status: "suspended",
							suspendedAt: new Date(),
							suspendedReason: data.reason || null,
							updatedAt: new Date(),
						}
					: {
							status: "active",
							suspendedAt: null,
							suspendedReason: null,
							updatedAt: new Date(),
						},
			)
			.where(eq(organization.id, data.orgId));

		return { status: data.status };
	});

/** The billing record. Payment happens off-app; this is where it is written down. */
export const updateBilling = createServerFn({ method: "POST" })
	.validator(
		orgIdSchema.extend({
			plan: z.string().trim().max(60).nullable(),
			priceMonthly: z.number().min(0).max(10_000_000).nullable(),
			currency: z.string().trim().toUpperCase().length(3),
			paidUntil: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/)
				.nullable(),
			billingNote: z.string().trim().max(500).nullable(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();

		await getDb()
			.update(organization)
			.set({
				plan: data.plan || null,
				priceMonthly:
					data.priceMonthly === null ? null : data.priceMonthly.toFixed(2),
				currency: data.currency,
				paidUntil: data.paidUntil,
				billingNote: data.billingNote || null,
				updatedAt: new Date(),
			})
			.where(eq(organization.id, data.orgId));

		return { saved: true };
	});

/** How big a client's team may be, and whether their owners may grow it. */
export const updateTeamLimits = createServerFn({ method: "POST" })
	.validator(
		orgIdSchema.extend({
			seatLimit: z.number().int().min(1).max(500).nullable(),
			teamInvitesEnabled: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();

		await getDb()
			.update(organization)
			.set({
				seatLimit: data.seatLimit,
				teamInvitesEnabled: data.teamInvitesEnabled,
				updatedAt: new Date(),
			})
			.where(eq(organization.id, data.orgId));

		return { saved: true };
	});

/**
 * Invites an owner into a client workspace — the first one, or a replacement
 * when the client's only owner has left. Not bound by the seat limit: the
 * admin is the one who sets it.
 */
export const inviteOwner = createServerFn({ method: "POST" })
	.validator(
		orgIdSchema.extend({
			email: z.string().trim().toLowerCase().email().max(254),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();
		return issueInvite({
			orgId: data.orgId,
			email: data.email,
			role: "owner",
			invitedBy: null,
		});
	});

export const adminWithdrawInvite = createServerFn({ method: "POST" })
	.validator(orgIdSchema.extend({ inviteId: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireAdmin();
		await withdrawInvite(data.orgId, data.inviteId);
		return { revoked: true };
	});
