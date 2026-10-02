/**
 * The products a workspace can subscribe to.
 *
 * Each is switched on per workspace by the platform admin (`org_modules`), and
 * every surface — the dashboard's shop window, the admin console, the server's
 * access checks — reads this list rather than hard-coding a module. Adding a
 * module is an entry here plus a value in the database's `module_key` enum.
 */
export const MODULES = {
	content: {
		key: "content",
		label: "Content Studio",
		description:
			"Drafts, a weekly plan and polished photos for your social channels, from the web or Telegram.",
		icon: "pen-line",
		/** Content is not metered in credits; spend is watched, not capped. */
		metered: false,
	},
	marketing: {
		key: "marketing",
		label: "Marketing Studio",
		description:
			"Turn product photos into AI promo images and videos, with a voiceover if you want one.",
		icon: "clapperboard",
		metered: true,
	},
} as const;

export type ModuleKey = keyof typeof MODULES;
export type ModuleSpec = (typeof MODULES)[ModuleKey];

export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export function isModuleKey(value: string): value is ModuleKey {
	return Object.hasOwn(MODULES, value);
}

/** What a marketing generation produces. */
export const PROMO_KINDS = ["image", "video", "video_voice"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const PROMO_KIND_LABELS: Record<PromoKind, string> = {
	image: "Image",
	video: "Video",
	video_voice: "Video + voice",
};

/** Video lengths offered. Providers accept 4, 6 and 8 seconds across models. */
export const PROMO_DURATIONS = [4, 6, 8] as const;
export type PromoDuration = (typeof PROMO_DURATIONS)[number];

export const PROMO_ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
export type PromoAspectRatio = (typeof PROMO_ASPECT_RATIOS)[number];

/** Aspect ratios video models accept; 1:1 and 4:5 are image-only. */
export const VIDEO_ASPECT_RATIOS = ["9:16", "16:9"] as const;

/**
 * Credits a generation costs the workspace. Clients see credits, never the
 * provider's price — that stays in the admin console.
 *
 * Pegged at roughly one credit per US$0.10 of provider cost (October 2026):
 * an image is ~$0.07; Veo 3.1 Fast video with audio is $0.12 a second; the
 * ElevenLabs voiceover is cents. Revisit when the models or prices change.
 */
export function promoCreditCost(
	kind: PromoKind,
	durationSecs: PromoDuration = 8,
): number {
	if (kind === "image") return 1;
	const video = Math.ceil(durationSecs * 1.2); // 4s → 5, 6s → 8, 8s → 10
	return kind === "video" ? video : video + 1;
}
