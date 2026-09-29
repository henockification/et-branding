import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import {
	getModelSpec,
	isModelId,
	type ModelId,
	type ModelTier,
	TIER_DEFAULTS,
	VISION_DEFAULT,
} from "./catalog.ts";

let provider: ReturnType<typeof createOpenRouter> | undefined;

/**
 * One provider for every model.
 *
 * Built on first use rather than at import: a missing key then fails on the
 * call that needs it, with a readable message, instead of taking down any
 * module that happens to import an agent.
 */
function getProvider(): ReturnType<typeof createOpenRouter> {
	if (!provider) {
		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			throw new Error(
				"OPENROUTER_API_KEY is not set — create a key at https://openrouter.ai/keys and put it in apps/web/.env.",
			);
		}

		provider = createOpenRouter({
			apiKey,
			headers: {
				// Attribution on OpenRouter's leaderboards; harmless, and it makes
				// this app's usage identifiable in their dashboard.
				"HTTP-Referer": "https://negarit-branding.henockmelisse.workers.dev",
				"X-Title": "Negarit Branding",
			},
		});
	}
	return provider;
}

/**
 * Resolve a tier (or an explicit catalog id) to a language model.
 *
 * `ET_DEFAULT_MODEL` overrides every tier at once, which is how to A/B a model
 * across the whole app — or pin everything to the free tier — without touching
 * code.
 */
export function resolveModel(tierOrId: ModelTier | ModelId): LanguageModel {
	return getProvider()(resolveModelId(tierOrId));
}

export function resolveModelId(tierOrId: ModelTier | ModelId): ModelId {
	const override = process.env.ET_DEFAULT_MODEL;
	if (override) {
		if (!isModelId(override)) {
			throw new Error(
				`ET_DEFAULT_MODEL="${override}" is not in the model catalog. See packages/agents/src/models/catalog.ts.`,
			);
		}
		return override;
	}
	return isModelId(tierOrId) ? tierOrId : TIER_DEFAULTS[tierOrId];
}

/**
 * The model that looks at photos.
 *
 * Deliberately ignores `ET_DEFAULT_MODEL`: pinning the app to a text-only model
 * for a test would otherwise break every photo draft with an opaque provider
 * error. `ET_VISION_MODEL` is its own override, and must be able to see.
 */
export function resolveVisionModelId(): ModelId {
	const override = process.env.ET_VISION_MODEL;
	if (!override) return VISION_DEFAULT;

	if (!isModelId(override) || !getModelSpec(override).seesImages) {
		throw new Error(
			`ET_VISION_MODEL="${override}" is not a catalog model that accepts images. See packages/agents/src/models/catalog.ts.`,
		);
	}
	return override;
}

/** Throws a readable error when the one required key is absent. */
export function assertModelUsable(_id: ModelId): void {
	if (!process.env.OPENROUTER_API_KEY) {
		throw new Error(
			"OPENROUTER_API_KEY is not set — create a key at https://openrouter.ai/keys and put it in apps/web/.env.",
		);
	}
}
