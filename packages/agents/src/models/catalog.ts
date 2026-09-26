/**
 * The model catalog is the single place where model ids live. Agents never
 * name a model directly — they ask for a `tier`, and the registry resolves it
 * here.
 *
 * Every model is reached through OpenRouter, so the ids are OpenRouter's
 * `vendor/model` form and there is one API key for all of them. Adding a model
 * is an edit to this file, not to any agent.
 *
 * Prices are USD per 1,000,000 tokens, taken from OpenRouter's own catalogue on
 * `pricedOn`. They move: re-check against
 * https://openrouter.ai/api/v1/models before quoting a figure to anyone.
 */

/** What a call is worth spending on, rather than which model to use. */
export type ModelTier =
	/** Costs nothing. Rate-limited by OpenRouter; for smoke tests and spikes. */
	| "free"
	/** Bulk, high-volume, low-stakes work: classification, extraction, drafts. */
	| "cheap"
	/** Default for user-facing generation where quality matters but cost still does. */
	| "balanced"
	/** Quality-critical work only: final copy, brand voice, tricky reasoning. */
	| "premium";

/** Who actually serves the model behind OpenRouter. Informational. */
export type Vendor = "deepseek" | "openai" | "anthropic" | "qwen";

export type ModelSpec = {
	/** OpenRouter model id, used verbatim in API calls. */
	readonly id: string;
	readonly vendor: Vendor;
	readonly usdPerMillionInput: number;
	readonly usdPerMillionOutput: number;
	/** Discounted rate for a prompt-cache hit, where the vendor offers one. */
	readonly usdPerMillionCachedInput?: number;
	readonly contextTokens: number;
	readonly pricedOn: string;
	readonly notes?: string;
};

export const MODEL_CATALOG = {
	"qwen/qwen3.8-27b:free": {
		id: "qwen/qwen3.8-27b:free",
		vendor: "qwen",
		usdPerMillionInput: 0,
		usdPerMillionOutput: 0,
		contextTokens: 262_144,
		pricedOn: "2026-09-26",
		notes:
			"Free, but measured as unreliable: upstream rate-limits reject calls even well inside the daily quota. Not worth using while the cheap tier costs ~$0.00001 a call.",
	},
	"deepseek/deepseek-v4-flash": {
		id: "deepseek/deepseek-v4-flash",
		vendor: "deepseek",
		usdPerMillionInput: 0.047,
		usdPerMillionOutput: 0.094,
		usdPerMillionCachedInput: 0.009,
		contextTokens: 1_048_576,
		pricedOn: "2026-09-26",
		notes: "Cheapest serious option, and a million tokens of context.",
	},
	"deepseek/deepseek-v3.2": {
		id: "deepseek/deepseek-v3.2",
		vendor: "deepseek",
		usdPerMillionInput: 0.269,
		usdPerMillionOutput: 0.4,
		usdPerMillionCachedInput: 0.134,
		contextTokens: 163_840,
		pricedOn: "2026-09-26",
		notes: "Step up from flash when drafts come back thin.",
	},
	"openai/gpt-4o-mini": {
		id: "openai/gpt-4o-mini",
		vendor: "openai",
		usdPerMillionInput: 0.15,
		usdPerMillionOutput: 0.6,
		usdPerMillionCachedInput: 0.075,
		contextTokens: 128_000,
		pricedOn: "2026-09-26",
		notes: "Comparison point; weaker at long-form brand copy.",
	},
	"anthropic/claude-haiku-4.5": {
		id: "anthropic/claude-haiku-4.5",
		vendor: "anthropic",
		usdPerMillionInput: 1,
		usdPerMillionOutput: 5,
		usdPerMillionCachedInput: 0.1,
		contextTokens: 200_000,
		pricedOn: "2026-09-26",
	},
	"anthropic/claude-sonnet-4.5": {
		id: "anthropic/claude-sonnet-4.5",
		vendor: "anthropic",
		usdPerMillionInput: 3,
		usdPerMillionOutput: 15,
		usdPerMillionCachedInput: 0.3,
		contextTokens: 1_000_000,
		pricedOn: "2026-09-26",
		notes: "Strong brand-voice writing; reserve for final passes.",
	},
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODEL_CATALOG;

/**
 * Which model each tier resolves to. Cost-first: the cheapest model that can
 * plausibly do the job wins, and only `premium` reaches for a frontier model.
 *
 * Amharic is the open question — nothing here has been measured on it yet. If
 * the cheap tier turns out to write poor Amharic, change it here and every
 * agent follows, with no other edit.
 */
export const TIER_DEFAULTS: Record<ModelTier, ModelId> = {
	free: "qwen/qwen3.8-27b:free",
	cheap: "deepseek/deepseek-v4-flash",
	balanced: "deepseek/deepseek-v3.2",
	premium: "anthropic/claude-sonnet-4.5",
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
