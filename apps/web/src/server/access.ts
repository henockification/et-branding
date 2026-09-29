import { and, eq, getDb, organization, orgMember } from "@et/db";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "#/server/auth";
import { fail } from "#/server/errors";
import { isPlatformAdmin } from "#/server/sign-up-policy";

/**
 * Who is asking, and what they may do in one workspace.
 *
 * The one place this is decided. Every server function and server route that
 * touches workspace data starts here: the `_authed` layout only decides which
 * screens render, and an org id from the client is never trusted on its own.
 *
 * Two separate axes, deliberately kept apart:
 * - Workspace roles (owner, approver, member) come only from membership. The
 *   platform admin gets none by default — a client's workspace is the
 *   client's, and the admin sees it through the console's account view.
 * - Platform admin powers (create, suspend, bill, set limits) live in
 *   `server/admin.ts` and never open a workspace's content.
 */

export type Role = "owner" | "approver" | "member";

export type Viewer = {
	userId: string;
	email: string;
	name: string;
	/** Platform admin: runs the admin console. Not a workspace role. */
	isAdmin: boolean;
};

export type Access = {
	viewer: Viewer;
	role: Role;
	/** Their membership row — used to attribute decisions. */
	memberId: string;
	/** Owners and approvers edit; members only look. */
	canEdit: boolean;
};

export async function getViewer(
	headers: Headers = getRequest().headers,
): Promise<Viewer | null> {
	const session = await getAuth().api.getSession({ headers });
	if (!session) return null;

	return {
		userId: session.user.id,
		email: session.user.email,
		name: session.user.name,
		isAdmin: isPlatformAdmin(session.user.email),
	};
}

/**
 * The caller's access to a workspace, or null.
 *
 * Null covers "not signed in", "not a member", "no such workspace" and
 * "suspended" alike for data access, so a response never confirms an id.
 * The dashboard is where a member learns their workspace is suspended.
 */
export async function readAccess(
	orgId: string,
	headers?: Headers,
): Promise<Access | null> {
	const viewer = await getViewer(headers);
	if (!viewer) return null;

	const [membership] = await getDb()
		.select({
			id: orgMember.id,
			role: orgMember.role,
			status: organization.status,
		})
		.from(orgMember)
		.innerJoin(organization, eq(organization.id, orgMember.orgId))
		.where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, viewer.userId)))
		.limit(1);

	if (!membership || membership.status !== "active") return null;

	return {
		viewer,
		role: membership.role,
		memberId: membership.id,
		canEdit: membership.role !== "member",
	};
}

/**
 * For mutations: throws a `RequestError` rather than returning null, so the
 * reason reaches the screen. A page loader should use `readAccess` instead and
 * turn null into the app's not-found page.
 */
export async function requireAccess(
	orgId: string,
	need: "read" | "edit" | "manage",
): Promise<Access> {
	const access = await readAccess(orgId);

	if (!access) {
		// Same answer for "not yours" and "does not exist".
		fail("Not found.", 404);
	}

	if (need === "edit" && !access.canEdit) {
		fail("Only an owner or approver can change this.", 403);
	}

	// Managing people is the owners' job alone.
	if (need === "manage" && access.role !== "owner") {
		fail("Only a workspace owner can manage its people.", 403);
	}

	return access;
}

export async function requireViewer(): Promise<Viewer> {
	const viewer = await getViewer();
	if (!viewer) fail("Not signed in.", 401);
	return viewer;
}

export async function requireAdmin(): Promise<Viewer> {
	const viewer = await requireViewer();
	if (!viewer.isAdmin) {
		fail("Only the platform admin can do that.", 403);
	}
	return viewer;
}
