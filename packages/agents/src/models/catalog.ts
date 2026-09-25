/**
 * The model catalog is the single place where provider-specific model ids live.
 * Agents never name a model directly — they ask for a `tier`, and the registry
 * resolves it here. Adding DeepSeek/OpenAI/whatever later is an edit to this
 * file, not to any agent.
 *
 * Prices are USD per 1,000,000 tokens and are INDICATIVE ONLY: verify against
 * the provider's pricing page before relying on a cost figure. `pricedOn`
 * records when each row was last checked.
 */

/** What a call is worth spending on, rather than which model to use. */
export type ModelTier =
	/** Bulk, high-volume, low-stakes work: classification, extraction, drafts. */
	| "cheap"
	/** Default for user-facing generation where quality matters but cost still does. */
	| "balanced"
	/** Quality-critical work only: final copy, brand voice, tricky reasoning. */
	| "premium";

export type ProviderId = "anthropic" | "openai" | "deepseek";

export type ModelSpec = {
	/** Registry id, always `provider:model`. */
	readonly id: string;
	readonly provider: ProviderId;
	/** The provider's own model id. */
	readonly model: string;
	readonly usdPerMillionInput: number;
	readonly usdPerMillionOutput: number;
	/** Discounted rate for reading a prompt cache hit, when the provider offers one. */
	readonly usdPerMillionCachedInput?: number;
	readonly pricedOn: string;
	readonly supportsTools: boolean;
	readonly notes?: string;
};

export const MODEL_CATALOG = {
	"deepseek:deepseek-chat": {
		id: "deepseek:deepseek-chat",
		provider: "deepseek",
		model: "deepseek-chat",
		usdPerMillionInput: 0.27,
		usdPerMillionOutput: 1.1,
		usdPerMillionCachedInput: 0.07,
		pricedOn: "2026-09-25",
		supportsTools: true,
		notes: "Cheapest tool-capable option; default for bulk work.",
	},
	"openai:gpt-4o-mini": {
		id: "openai:gpt-4o-mini",
		provider: "openai",
		model: "gpt-4o-mini",
		usdPerMillionInput: 0.15,
		usdPerMillionOutput: 0.6,
		pricedOn: "2026-09-25",
		supportsTools: true,
		notes: "Cheap and fast; weaker at long-form brand copy.",
	},
	"anthropic:claude-haiku-4-5": {
		id: "anthropic:claude-haiku-4-5",
		provider: "anthropic",
		model: "claude-haiku-4-5-20251001",
		usdPerMillionInput: 1,
		usdPerMillionOutput: 5,
		usdPerMillionCachedInput: 0.1,
		pricedOn: "2026-09-25",
		supportsTools: true,
	},
	"anthropic:claude-sonnet-5": {
		id: "anthropic:claude-sonnet-5",
		provider: "anthropic",
		model: "claude-sonnet-5",
		usdPerMillionInput: 3,
		usdPerMillionOutput: 15,
		usdPerMillionCachedInput: 0.3,
		pricedOn: "2026-09-25",
		supportsTools: true,
		notes: "Strong brand-voice writing; reserve for final passes.",
	},
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODEL_CATALOG;

/**
 * Which model each tier resolves to. Cost-first: the cheapest model that can
 * plausibly do the job wins, and only `premium` reaches for a frontier model.
 */
export const TIER_DEFAULTS: Record<ModelTier, ModelId> = {
	cheap: "deepseek:deepseek-chat",
	balanced: "deepseek:deepseek-chat",
	premium: "anthropic:claude-sonnet-5",
};

export function getModelSpec(id: ModelId): ModelSpec {
	return MODEL_CATALOG[id];
}

export function isModelId(value: string): value is ModelId {
	return Object.hasOwn(MODEL_CATALOG, value);
}

/** Every catalog entry, widened to `ModelSpec` so optional fields read cleanly. */
export function listModelSpecs(): readonly ModelSpec[] {
	return Object.values(MODEL_CATALOG);
}
