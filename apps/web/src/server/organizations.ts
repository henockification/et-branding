import { brandProfile, desc, eq, getDb, organization, orgMember } from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAuth } from "#/server/auth";

/**
 * Every function here re-checks the session itself.
 *
 * The `_authed` layout only decides which screens render — server functions are
 * ordinary endpoints anyone can call directly, so the authorization boundary
 * sits here, next to the data access.
 */
async function requireUserId(): Promise<string> {
	const request = getRequest();
	const session = await getAuth().api.getSession({ headers: request.headers });

	if (!session) {
		// A Response, not an Error: an unauthenticated call is a 401, not a crash.
		throw new Response("Not signed in.", { status: 401 });
	}

	return session.user.id;
}

/**
 * Organizations the caller belongs to, with the brand each one is building.
 *
 * Scoped by membership rather than by an id from the client — with `org_id` on
 * every table, tenant isolation is only real if every read starts from who is
 * asking.
 */
export const listOrganizations = createServerFn({ method: "GET" }).handler(
	async () => {
		const userId = await requireUserId();

		return getDb()
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				role: orgMember.role,
				brandName: brandProfile.name,
				brandSummary: brandProfile.summary,
				createdAt: organization.createdAt,
			})
			.from(orgMember)
			.innerJoin(organization, eq(organization.id, orgMember.orgId))
			.leftJoin(brandProfile, eq(brandProfile.orgId, organization.id))
			.where(eq(orgMember.userId, userId))
			.orderBy(desc(organization.createdAt));
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
 * Creates the organization, its brand profile and the caller's owner
 * membership.
 *
 * Sent as one batch: Neon's HTTP driver has no interactive transactions, and
 * three separate round trips could leave an organization nobody can reach.
 */
export const createOrganization = createServerFn({ method: "POST" })
	.validator(z.object({ name: z.string().trim().min(1).max(80) }))
	.handler(async ({ data }) => {
		const userId = await requireUserId();
		const db = getDb();

		const [created] = await db
			.insert(organization)
			.values({ name: data.name, slug: slugify(data.name) })
			.returning({ id: organization.id, slug: organization.slug });

		if (!created) {
			throw new Response("Could not create that organization.", {
				status: 500,
			});
		}

		const session = await getAuth().api.getSession({
			headers: getRequest().headers,
		});

		await db.batch([
			db.insert(brandProfile).values({ orgId: created.id, name: data.name }),
			db.insert(orgMember).values({
				orgId: created.id,
				userId,
				displayName: session?.user.name || session?.user.email || "Owner",
				role: "owner",
			}),
		]);

		return created;
	});
