/**
 * Linking a replied-to message back to the draft it concerns.
 *
 * Telegram carries no payload on a reply — only the text of the message being
 * replied to. So the draft's id is written into that text as a short
 * reference, and read back out when someone replies. That keeps both follow-up
 * flows stateless: no pending-action column, no expiry to manage, and two
 * drafts can be handled at once without one clobbering the other.
 *
 * The label carries the intent as well as the id. Inferring intent from the
 * item's current status would be guesswork — the same reply shape means
 * "here is my rewrite" after Edit and "here is why" after Reject — so the
 * prompt that asked says which it wanted.
 *
 * Eight hex characters of a UUID is 4 billion values, and lookups are scoped to
 * one organization, so a collision would need two drafts in the same workspace
 * sharing a prefix.
 */

export type RefKind = "edit" | "reason" | "draft";

/**
 * The label says what a reply to that message MEANS.
 *
 * This distinction is load-bearing, and getting it wrong is expensive:
 * `Ref` appears only on the Edit prompt, so a reply to it is a human rewrite
 * that approves the item and records a correction pair. `Draft` appears in the
 * footer of a delivered draft, where a reply is a free-text instruction to try
 * again — not a rewrite.
 *
 * Before this split both carried `Ref`, so replying to a draft with any prose
 * silently approved it and recorded a correction the person never made.
 *
 * Never rename these strings: messages already sitting in people's chats are
 * matched against them.
 */
const LABELS: Record<RefKind, string> = {
	edit: "Ref",
	reason: "Why",
	draft: "Draft",
};

const REF_PATTERN = /\b(Ref|Why|Draft):\s*([0-9a-f]{8})/i;

export function formatRef(id: string, kind: RefKind = "edit"): string {
	return `${LABELS[kind]}: ${id.replace(/-/g, "").slice(0, 8)}`;
}

/** Reads a draft reference, and what was asked for, out of a message's text. */
export function parseRef(
	text: string | undefined,
): { kind: RefKind; id: string } | null {
	if (!text) return null;

	const match = REF_PATTERN.exec(text);
	if (!match?.[1] || !match[2]) return null;

	const label = match[1].toLowerCase();

	return {
		kind: label === "why" ? "reason" : label === "draft" ? "draft" : "edit",
		id: match[2].toLowerCase(),
	};
}
