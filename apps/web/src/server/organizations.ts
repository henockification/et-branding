import { brandProfile, desc, eq, getDb, organization, orgMember } from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { requireViewer } from "#/server/access";
import { moduleStates } from "#/server/modules";

/**
 * Workspaces the caller belongs to, with the brand each one is building.
 *
 * Membership only — the platform admin sees other people's workspaces in the
 * admin console, as accounts, not here as workspaces to open. Suspended ones
 * are still listed, so their people learn why nothing opens.
 */
export const listOrganizations = createServerFn({ method: "GET" }).handler(
	async () => {
		const viewer = await requireViewer();

		const organizations = await getDb()
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				role: orgMember.role,
				status: organization.status,
				suspendedReason: organization.suspendedReason,
				brandName: brandProfile.name,
				brandSummary: brandProfile.summary,
				createdAt: organization.createdAt,
			})
			.from(orgMember)
			.innerJoin(organization, eq(organization.id, orgMember.orgId))
			.leftJoin(brandProfile, eq(brandProfile.orgId, organization.id))
			// Scoped by who is asking, never by an id from the client.
			.where(eq(orgMember.userId, viewer.userId))
			.orderBy(desc(organization.createdAt));

		// The shop window: which products each workspace has, and which it
		// could have. A handful of workspaces per person, so one query each.
		const withModules = await Promise.all(
			organizations.map(async (org) => ({
				...org,
				modules: await moduleStates(org.id),
			})),
		);

		return { isAdmin: viewer.isAdmin, organizations: withModules };
	},
);
