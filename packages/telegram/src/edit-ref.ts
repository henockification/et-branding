/**
 * Linking a replied-to message back to the draft it concerns.
 *
 * Telegram carries no payload on a reply — only the text of the message being
 * replied to. So the draft's id is written into that text as a short
 * reference, and read back out when someone replies. That keeps the edit flow
 * stateless: no pending-edit column, no expiry to manage, and two drafts can be
 * edited at once without one clobbering the other.
 *
 * Eight hex characters of a UUID is 4 billion values, and lookups are scoped to
 * one organization, so a collision would need two drafts in the same workspace
 * sharing a prefix.
 */

const REF_PATTERN = /Ref:\s*([0-9a-f]{8})/i;

export function formatRef(id: string): string {
	return `Ref: ${id.replace(/-/g, "").slice(0, 8)}`;
}

/** Reads a draft reference out of a message's text, if it has one. */
export function parseRef(text: string | undefined): string | null {
	if (!text) return null;
	const match = REF_PATTERN.exec(text);
	return match?.[1]?.toLowerCase() ?? null;
}
