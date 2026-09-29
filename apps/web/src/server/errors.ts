/**
 * A refusal a server function sends back to the person using the app.
 *
 * An `Error`, never a thrown `Response`. TanStack Start hands a thrown
 * Response back to the browser as the call's *result* (marked "raw"), so the
 * mutation reports success and the screen renders whatever is missing — which
 * is how "Invite to Telegram" came to show `/start undefined` instead of the
 * reason it was refused. An Error is serialised as a failure, and its message
 * reaches the UI's error state intact, so write it for the person reading it.
 *
 * Server routes (`src/routes/api/**`) are different: they answer HTTP
 * directly, and returning a Response there is correct.
 */
export class RequestError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "RequestError";
		this.status = status;
	}
}

export function fail(message: string, status: number): never {
	throw new RequestError(message, status);
}
