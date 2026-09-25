import type { Session } from "@et/auth";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "#/server/auth";

/**
 * The signed-in user, or null. Reads the session cookie off the incoming
 * request, so it works during SSR as well as from the client.
 */
export const fetchSession = createServerFn({ method: "GET" }).handler(
	async (): Promise<Session | null> => {
		const request = getRequest();
		const session = await getAuth().api.getSession({
			headers: request.headers,
		});
		return session ?? null;
	},
);

/**
 * Which social providers are actually configured, so the sign-in page never
 * shows a button that would fail at the provider's redirect.
 */
export const fetchAuthProviders = createServerFn({ method: "GET" }).handler(
	async () => ({
		google: Boolean(
			process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
		),
	}),
);
