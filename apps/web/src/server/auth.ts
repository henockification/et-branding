import { type Auth, createAuthFromEnv } from "@et/auth";

let cached: Auth | undefined;

/**
 * The process-wide auth instance.
 *
 * Built on first use rather than at module load: a Worker isolate may be warm
 * across requests, so this is built once, but a missing secret then throws on
 * the request that needs it instead of taking the whole module down at import.
 */
export function getAuth(): Auth {
	cached ??= createAuthFromEnv(process.env);
	return cached;
}
