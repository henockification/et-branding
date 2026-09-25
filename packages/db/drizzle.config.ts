import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs under plain Node, not the Worker, so it cannot see the
 * Cloudflare dev runtime's environment. Rather than keep a second copy of the
 * connection string in a root `.env`, read the one file that already holds it.
 */
function readDevVar(name: string): string {
	const here = dirname(fileURLToPath(import.meta.url));
	// Either name works: .dev.vars is what the Workers runtime reads, and
	// apps/web/scripts/link-env.mjs links it to .env when that is what exists.
	const candidates = [
		resolve(here, "../../apps/web/.dev.vars"),
		resolve(here, "../../apps/web/.env"),
	];

	let contents: string | undefined;
	for (const candidate of candidates) {
		try {
			contents = readFileSync(candidate, "utf8");
			break;
		} catch {
			// Try the next name.
		}
	}

	if (contents === undefined) {
		throw new Error(
			`${name} is not set and neither ${candidates.join(" nor ")} exists. Copy apps/web/.dev.vars.example to apps/web/.env and fill it in.`,
		);
	}

	for (const line of contents.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) continue;

		const separator = trimmed.indexOf("=");
		if (separator === -1) continue;

		if (trimmed.slice(0, separator).trim() !== name) continue;
		// Values may or may not be quoted; both forms are valid in .dev.vars.
		return trimmed
			.slice(separator + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
	}

	throw new Error(`${name} is not set in ${candidates.join(" or ")}.`);
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema/index.ts",
	out: "./migrations",
	dbCredentials: {
		url: process.env.DATABASE_URL || readDevVar("DATABASE_URL"),
	},
	// Neon branches are cheap, so keep migrations explicit and reviewable
	// rather than pushing schema changes straight at a database.
	strict: true,
	verbose: true,
});
