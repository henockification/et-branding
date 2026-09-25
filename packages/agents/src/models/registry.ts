import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createProviderRegistry, type LanguageModel } from "ai";
import {
	getModelSpec,
	isModelId,
	type ModelId,
	type ModelTier,
	TIER_DEFAULTS,
} from "./catalog.ts";

/**
 * One registry over every provider we support. Providers are constructed
 * lazily-ish: a missing API key only fails when a model from that provider is
 * actually used, so a dev with only a DeepSeek key can still run the app.
 */
const registry = createProviderRegistry({
	anthropic: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
	openai: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
	deepseek: createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY }),
});

/**
 * Resolve a tier (or an explicit catalog id) to a language model.
 *
 * `ET_DEFAULT_MODEL` overrides every tier at once, which is how you A/B a
 * provider across the whole app without touching code.
 */
export function resolveModel(tierOrId: ModelTier | ModelId): LanguageModel {
	return registry.languageModel(resolveModelId(tierOrId));
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

/** Throws a readable error when the key for a model's provider is absent. */
export function assertModelUsable(id: ModelId): void {
	const { provider } = getModelSpec(id);
	const envVar = {
		anthropic: "ANTHROPIC_API_KEY",
		openai: "OPENAI_API_KEY",
		deepseek: "DEEPSEEK_API_KEY",
	}[provider];

	if (!process.env[envVar]) {
		throw new Error(`${id} needs ${envVar} to be set (see .env.example).`);
	}
}
