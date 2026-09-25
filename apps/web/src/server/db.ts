import { getDb, pingDatabase } from "@et/db";
import { createServerFn } from "@tanstack/react-start";

/**
 * Proves the Neon connection without asserting anything about the schema —
 * useful before there are any tables, and as a deploy smoke test after.
 */
export const checkDatabase = createServerFn({ method: "GET" }).handler(
	async () => {
		try {
			const ok = await pingDatabase(getDb());
			return { ok, error: null as string | null };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},
);
