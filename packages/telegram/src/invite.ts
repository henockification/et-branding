/**
 * Signed invite links for `/start`.
 *
 * Telegram's deep-link payload is capped at 64 characters from the alphabet
 * [A-Za-z0-9_-], which rules out putting a UUID, an expiry and a full signature
 * in as text. So the token is packed binary and base64url'd:
 *
 *     16 bytes  org id (the UUID's raw bytes)
 *      4 bytes  expiry, unix minutes, big-endian
 *     10 bytes  truncated HMAC-SHA256 over the first 20
 *     ────────
 *     30 bytes → 40 characters
 *
 * Truncating the MAC to 80 bits is deliberate: these links live for hours, and
 * forging one requires a preimage, not a collision.
 *
 * Signed rather than stored so an invite costs no table and no cleanup job.
 */

const ORG_BYTES = 16;
const EXP_BYTES = 4;
const SIG_BYTES = 10;
const SIGNED_BYTES = ORG_BYTES + EXP_BYTES;

export const INVITE_TTL_MINUTES = 60 * 24;

function uuidToBytes(uuid: string): Uint8Array {
	const hex = uuid.replace(/-/g, "");
	if (hex.length !== 32 || !/^[0-9a-f]{32}$/i.test(hex)) {
		throw new Error(`Not a UUID: ${uuid}`);
	}

	const bytes = new Uint8Array(ORG_BYTES);
	for (let i = 0; i < ORG_BYTES; i += 1) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20),
	].join("-");
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
	const padded = text.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// Uint8Array<ArrayBuffer>, not plain Uint8Array: Web Crypto will not accept a
// view that might be backed by a SharedArrayBuffer.
async function sign(
	secret: string,
	payload: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, payload);
	return new Uint8Array(mac).slice(0, SIG_BYTES);
}

/** Constant-time compare, so a wrong signature leaks nothing through timing. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

export async function createInviteToken(options: {
	orgId: string;
	secret: string;
	ttlMinutes?: number;
}): Promise<string> {
	const payload = new Uint8Array(SIGNED_BYTES);
	payload.set(uuidToBytes(options.orgId), 0);

	const expiresAt = Math.floor(
		Date.now() / 60_000 + (options.ttlMinutes ?? INVITE_TTL_MINUTES),
	);
	new DataView(payload.buffer).setUint32(ORG_BYTES, expiresAt, false);

	const signature = await sign(options.secret, payload);

	const token = new Uint8Array(SIGNED_BYTES + SIG_BYTES);
	token.set(payload, 0);
	token.set(signature, SIGNED_BYTES);

	return base64UrlEncode(token);
}

export type InviteResult =
	| { ok: true; orgId: string }
	| { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export async function verifyInviteToken(
	token: string,
	secret: string,
): Promise<InviteResult> {
	let bytes: Uint8Array;
	try {
		bytes = base64UrlDecode(token);
	} catch {
		return { ok: false, reason: "malformed" };
	}

	if (bytes.length !== SIGNED_BYTES + SIG_BYTES) {
		return { ok: false, reason: "malformed" };
	}

	const payload = bytes.slice(0, SIGNED_BYTES) as Uint8Array<ArrayBuffer>;
	const provided = bytes.slice(SIGNED_BYTES);
	const expected = await sign(secret, payload);

	// Signature first: never read the org id out of an unverified token.
	if (!equal(provided, expected)) {
		return { ok: false, reason: "bad_signature" };
	}

	const expiresAt = new DataView(
		payload.buffer,
		payload.byteOffset,
		payload.byteLength,
	).getUint32(ORG_BYTES, false);

	if (expiresAt * 60_000 < Date.now()) {
		return { ok: false, reason: "expired" };
	}

	return { ok: true, orgId: bytesToUuid(payload.slice(0, ORG_BYTES)) };
}

/** The link to hand someone: https://t.me/<bot>?start=<token> */
export function inviteLink(botUsername: string, token: string): string {
	return `https://t.me/${botUsername}?start=${token}`;
}
