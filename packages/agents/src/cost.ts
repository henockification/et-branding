import type { LanguageModelUsage } from "ai";
import { getModelSpec, type ModelId } from "./models/catalog.ts";

export type CallCost = {
	readonly modelId: ModelId;
	readonly inputTokens: number;
	readonly cachedInputTokens: number;
	readonly outputTokens: number;
	readonly usd: number;
};

const PER_MILLION = 1_000_000;

/**
 * Turn an AI SDK usage report into a dollar figure using the catalog's prices.
 *
 * Cached input tokens are billed at the provider's cache-read rate when one is
 * published, which is what makes a long, stable system prompt cheap to reuse.
 */
export function estimateCost(
	modelId: ModelId,
	usage: LanguageModelUsage,
): CallCost {
	const spec = getModelSpec(modelId);

	const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
	const totalInputTokens = usage.inputTokens ?? 0;
	const uncachedInputTokens = Math.max(totalInputTokens - cachedInputTokens, 0);
	const outputTokens = usage.outputTokens ?? 0;

	const cachedRate = spec.usdPerMillionCachedInput ?? spec.usdPerMillionInput;

	const usd =
		(uncachedInputTokens * spec.usdPerMillionInput +
			cachedInputTokens * cachedRate +
			outputTokens * spec.usdPerMillionOutput) /
		PER_MILLION;

	return {
		modelId,
		inputTokens: totalInputTokens,
		cachedInputTokens,
		outputTokens,
		usd,
	};
}

export function sumCosts(costs: readonly CallCost[]): number {
	return costs.reduce((total, cost) => total + cost.usd, 0);
}

export function formatUsd(usd: number): string {
	// Sub-cent calls are the norm on the cheap tier, so don't round them to $0.00.
	const fractionDigits = usd > 0 && usd < 0.01 ? 6 : 4;
	return `$${usd.toFixed(fractionDigits)}`;
}
