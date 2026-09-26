import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema/index.ts";

export {
	and,
	asc,
	desc,
	eq,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
export * from "./schema/index.ts";

export type Database = ReturnType<typeof createDb>;

/**
 * Build a Drizzle client over Neon's HTTP driver.
 *
 * HTTP (not the WebSocket pool) is the right driver on Cloudflare Workers:
 * each query is a stateless fetch, so there is no connection to hold open
 * across an isolate's lifetime and no pool to exhaust. The tradeoff is that
 * interactive transactions are unavailable — batch with `db.batch()` instead.
 */
export function createDb(
	connectionString: string,
): ReturnType<typeof drizzle<typeof schema>> {
	if (!connectionString) {
		throw new Error(
			"DATABASE_URL is empty — see .env.example for the Neon connection string.",
		);
	}
	return drizzle(neon(connectionString), { schema });
}

let cached: Database | undefined;

/**
 * The process-wide client, built from `DATABASE_URL` on first use. Workers
 * reuse a warm isolate across requests, so caching avoids rebuilding the
 * client on every call while still failing loudly when the URL is missing.
 */
export function getDb(): Database {
	cached ??= createDb(process.env.DATABASE_URL ?? "");
	return cached;
}

/**
 * Round-trips a trivial query. Use it to prove the connection, not liveness.
 *
 * Drizzle's own error says only which query failed, so the driver's cause —
 * the part that names a bad host or password — is folded into the message.
 */
export async function pingDatabase(db: Database = getDb()): Promise<boolean> {
	try {
		const result = await db.execute(sql`select 1 as ok`);
		return result.rows.at(0)?.ok === 1;
	} catch (error) {
		const cause = error instanceof Error ? error.cause : undefined;
		const detail = cause instanceof Error ? cause.message : String(cause ?? "");
		throw new Error(
			detail
				? `Could not reach the database: ${detail}`
				: "Could not reach the database.",
			{ cause: error },
		);
	}
}
