import {
	type BrandAudience,
	type BrandServices,
	type BrandVoice,
	brandProfileInputSchema,
} from "@et/core";
import { and, brandProfile, eq, getDb, organization, orgMember } from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAuth } from "#/server/auth";

/**
 * Resolves the caller's membership of one organization.
 *
 * The org id arrives from the client, so it is never trusted on its own —
 * every read and write starts from "is this person in this workspace", which is
 * what keeps one tenant out of another's data.
 */
async function requireMembership(
	orgId: string,
): Promise<{ userId: string; role: "owner" | "approver" | "member" }> {
	const session = await getAuth().api.getSession({
		headers: getRequest().headers,
	});

	if (!session) {
		throw new Response("Not signed in.", { status: 401 });
	}

	const [membership] = await getDb()
		.select({ role: orgMember.role })
		.from(orgMember)
		.where(
			and(eq(orgMember.orgId, orgId), eq(orgMember.userId, session.user.id)),
		)
		.limit(1);

	if (!membership) {
		// Deliberately the same answer as a workspace that does not exist: a
		// different message would confirm the id is real.
		throw new Response("Not found.", { status: 404 });
	}

	return { userId: session.user.id, role: membership.role };
}

/**
 * The read path returns rather than throws.
 *
 * A thrown `Response` is right for a mutation, but a page loader that throws
 * one escapes as an unhandled 500 and the visitor sees raw JSON instead of the
 * app. Writes below still throw, because there the caller is code, not a route.
 */
async function readMembership(
	orgId: string,
): Promise<{ role: "owner" | "approver" | "member" } | null> {
	const session = await getAuth().api.getSession({
		headers: getRequest().headers,
	});

	if (!session) return null;

	const [membership] = await getDb()
		.select({ role: orgMember.role })
		.from(orgMember)
		.where(
			and(eq(orgMember.orgId, orgId), eq(orgMember.userId, session.user.id)),
		)
		.limit(1);

	return membership ?? null;
}

const orgIdSchema = z.object({ orgId: z.string().uuid() });

export const fetchBrandProfile = createServerFn({ method: "GET" })
	.validator(orgIdSchema)
	.handler(async ({ data }) => {
		const membership = await readMembership(data.orgId);
		if (!membership) return { found: false } as const;

		const [row] = await getDb()
			.select({
				orgName: organization.name,
				name: brandProfile.name,
				summary: brandProfile.summary,
				voice: brandProfile.voice,
				audience: brandProfile.audience,
				services: brandProfile.services,
			})
			.from(organization)
			.leftJoin(brandProfile, eq(brandProfile.orgId, organization.id))
			.where(eq(organization.id, data.orgId))
			.limit(1);

		if (!row) return { found: false } as const;

		return {
			found: true as const,
			role: membership.role,
			orgName: row.orgName,
			name: row.name ?? row.orgName,
			summary: row.summary ?? "",
			voice: (row.voice ?? {}) as BrandVoice,
			audience: (row.audience ?? {}) as BrandAudience,
			services: (row.services ?? {}) as BrandServices,
		};
	});

export const saveBrandProfile = createServerFn({ method: "POST" })
	.validator(orgIdSchema.extend({ profile: brandProfileInputSchema }))
	.handler(async ({ data }) => {
		const { role } = await requireMembership(data.orgId);

		if (role === "member") {
			throw new Response("Only an owner or approver can edit the brand.", {
				status: 403,
			});
		}

		const values = {
			name: data.profile.name,
			summary: data.profile.summary ?? null,
			voice: data.profile.voice ?? null,
			audience: data.profile.audience ?? null,
			services: data.profile.services ?? null,
			updatedAt: new Date(),
		};

		// Upsert rather than update: an organization created before profiles
		// existed, or by a path that skipped one, should still be editable.
		await getDb()
			.insert(brandProfile)
			.values({ orgId: data.orgId, ...values })
			.onConflictDoUpdate({ target: brandProfile.orgId, set: values });

		return { saved: true };
	});
