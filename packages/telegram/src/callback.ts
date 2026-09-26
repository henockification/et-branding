/**
 * Inline-button payloads.
 *
 * Telegram caps callback_data at 64 bytes, so a UUID goes in as its raw bytes
 * base64url'd (22 chars) rather than as 36 characters of text.
 */

export const CALLBACK_ACTIONS = ["approve", "reject", "edit"] as const;
export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];

const PREFIX: Record<CallbackAction, string> = {
	approve: "a",
	reject: "r",
	edit: "e",
};

const ACTION_BY_PREFIX = Object.fromEntries(
	Object.entries(PREFIX).map(([action, prefix]) => [prefix, action]),
) as Record<string, CallbackAction>;

function compactUuid(uuid: string): string {
	const hex = uuid.replace(/-/g, "");
	const bytes = Uint8Array.from(
		{ length: 16 },
		(_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0,
	);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function expandUuid(compact: string): string | null {
	try {
		const padded = compact.replace(/-/g, "+").replace(/_/g, "/");
		const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
		if (binary.length !== 16) return null;

		const hex = Array.from(binary, (char) =>
			char.charCodeAt(0).toString(16).padStart(2, "0"),
		).join("");

		return [
			hex.slice(0, 8),
			hex.slice(8, 12),
			hex.slice(12, 16),
			hex.slice(16, 20),
			hex.slice(20),
		].join("-");
	} catch {
		return null;
	}
}

export function callbackData(action: CallbackAction, id: string): string {
	return `${PREFIX[action]}:${compactUuid(id)}`;
}

export function parseCallbackData(
	data: string | undefined,
): { action: CallbackAction; id: string } | null {
	if (!data) return null;

	const [prefix, compact] = data.split(":");
	const action = prefix ? ACTION_BY_PREFIX[prefix] : undefined;
	if (!action || !compact) return null;

	const id = expandUuid(compact);
	return id ? { action, id } : null;
}
