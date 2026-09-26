import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The Worker's per-request `ExecutionContext`.
 *
 * Cloudflare hands `ctx` to `fetch(request, env, ctx)`, but TanStack Start's
 * server routes receive only the request — `waitUntil` appears nowhere in its
 * types. Since we already own the Worker entry (src/worker.ts), the context is
 * put into async-local storage there and read back here.
 *
 * A module-scoped variable would be simpler and wrong: concurrent requests in
 * one isolate would overwrite each other's context.
 */
export type ExecutionContextLike = {
	waitUntil(promise: Promise<unknown>): void;
};

const storage = new AsyncLocalStorage<ExecutionContextLike>();

export function runWithExecutionContext<T>(
	ctx: ExecutionContextLike,
	fn: () => T,
): T {
	return storage.run(ctx, fn);
}

/** The current request's context, or undefined outside a Worker request. */
export function executionContext(): ExecutionContextLike | undefined {
	return storage.getStore();
}

/**
 * Run work after the response has been sent, when the platform allows it.
 *
 * Returns whether the work was deferred. Callers that need the work to happen
 * either way must await the promise themselves when this returns false.
 */
export function deferWork(promise: Promise<unknown>): boolean {
	const ctx = executionContext();
	if (!ctx) return false;

	ctx.waitUntil(promise);
	return true;
}
