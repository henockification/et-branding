import { existsSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Cloudflare dev runtime reads `.dev.vars`, but `.env` is the name everyone
 * reaches for. Rather than keep two copies of the same secrets in sync, link
 * one to the other so either name works and there is still a single file.
 *
 * Runs before `dev`. Does nothing if `.dev.vars` already exists as a real file.
 */
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devVars = resolve(appDir, ".dev.vars");
const dotEnv = resolve(appDir, ".env");

if (!existsSync(devVars) && existsSync(dotEnv)) {
	symlinkSync(dotEnv, devVars);
	console.log("Linked apps/web/.dev.vars -> .env");
}
