// The Workers runtime's own bindings. This app only ever runs on Workers
// (the Cloudflare Vite plugin serves it in dev too), so the import is safe.
import { env as workerEnv } from "cloudflare:workers";
import { type Auth, createAuthFromEnv } from "@et/auth";
import { resolveEmailSender } from "#/server/email";

let cached: Auth | undefined;

/**
 * The process-wide auth instance.
 *
 * Built on first use rather than at module load: a Worker isolate may be warm
 * across requests, so this is built once, but a missing secret then throws on
 * the request that needs it instead of taking the whole module down at import.
 */
export function getAuth(): Auth {
	cached ??= createAuthFromEnv(process.env, {
		email: resolveEmailSender(workerEnv),
	});
	return cached;
}
