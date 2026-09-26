/**
 * Everything the product is called and the identity it ships with, in one
 * place. Values come from the design system in docs/brand.
 *
 * The product was renamed from "ET Branding" to "Negarit Branding" by editing
 * this file and the `name` in apps/web/wrangler.jsonc (the Worker's identity,
 * which must match the deployed service). The mark needed no change at all —
 * it has no letters in it, which is exactly why it was drawn that way.
 *
 * Note: docs/brand/ is a faithful snapshot of the design system artifact and
 * still carries the old working name. Update it at the source, not here.
 */
export const BRANDING = {
	/** Full product name, used in titles and the wordmark. */
	name: "Negarit Branding",
	/** Short form for tight spaces. */
	shortName: "Negarit",
	/** One line, in the brand voice: outcomes, not AI for its own sake. */
	tagline: "Launch a brand. Grow it everywhere.",
	/** What the product actually is, for meta description and hero copy. */
	description:
		"A team of AI agents that builds and runs your brand — strategy, content, design and distribution, working together so you can launch and grow without a full agency.",
	/** Matches the `brand` token, Ultraviolet. Used for browser chrome. */
	themeColor: "#6a2be0",
} as const;

/**
 * The mark is "Social Brain": two hemispheres (AI), a speech-bubble tail
 * (conversation), a three-node share shape and a lime notification dot
 * (social). Each file has one correct ground — the system forbids recolouring,
 * mirroring or rotating it, so pick a variant rather than restyling one.
 */
export const LOGO = {
	/** Default: Ultraviolet brain on light grounds. */
	primary: "/brand/mark-primary.svg",
	/** White brain on ink, brand-deep or photography. */
	reverse: "/brand/mark-reverse.svg",
	/** App icon, favicon and avatar on an Ultraviolet tile. */
	appIcon: "/brand/app-icon.svg",
	/** App icon on the dark ink tile. */
	appIconDark: "/brand/app-icon-dark.svg",
} as const;

/**
 * Clear space is one notification-dot diameter on every side, about a sixth of
 * the mark's width. Below 24px use the app icon instead of the mark.
 */
export const LOGO_RULES = {
	minSizePx: 16,
	preferAppIconBelowPx: 24,
	clearSpaceRatio: 1 / 6,
} as const;

export type Branding = typeof BRANDING;
