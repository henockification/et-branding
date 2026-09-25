import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "#/server/auth";

/**
 * Every Better Auth endpoint — sign-in, sign-up, the Google callback, sign-out
 * — lives under this one splat route and is handled by the library.
 */
const handle = ({ request }: { request: Request }) =>
	getAuth().handler(request);

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
		},
	},
});
