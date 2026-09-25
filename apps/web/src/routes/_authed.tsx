import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { fetchSession } from "#/server/session";

/**
 * Everything nested under this pathless layout requires a signed-in user.
 *
 * This is a UI guard, not an authorization boundary: server functions and
 * server routes are reachable on their own, so each one still has to check the
 * session itself. Its job is to keep signed-out visitors off screens they
 * cannot use, and to put the user in route context for the pages below.
 */
export const Route = createFileRoute("/_authed")({
	beforeLoad: async ({ location }) => {
		const session = await fetchSession();

		if (!session) {
			throw redirect({
				to: "/sign-in",
				search: { redirect: location.href },
			});
		}

		return { session, user: session.user };
	},
	component: () => <Outlet />,
});
