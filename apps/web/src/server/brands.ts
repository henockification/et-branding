import { brand, desc, eq, getDb } from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAuth } from "#/server/auth";

/**
 * Every function here re-checks the session itself.
 *
 * The `_authed` layout only decides which screens render — server functions are
 * ordinary endpoints that anyone can call directly, so the authorization
 * boundary has to sit here, next to the data access.
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

export const listBrands = createServerFn({ method: "GET" }).handler(
	async () => {
		const ownerId = await requireUserId();

		return (
			getDb()
				.select({
					id: brand.id,
					name: brand.name,
					summary: brand.summary,
					createdAt: brand.createdAt,
				})
				.from(brand)
				// Scoped to the caller, never to an id the client supplies.
				.where(eq(brand.ownerId, ownerId))
				.orderBy(desc(brand.createdAt))
		);
	},
);

export const createBrand = createServerFn({ method: "POST" })
	.validator(z.object({ name: z.string().trim().min(1).max(80) }))
	.handler(async ({ data }) => {
		const ownerId = await requireUserId();

		const [created] = await getDb()
			.insert(brand)
			.values({ ownerId, name: data.name })
			.returning({ id: brand.id, name: brand.name });

		return created;
	});
