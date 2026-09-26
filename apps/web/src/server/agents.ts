import { defineAgent, estimateCost, listModelSpecs } from "@et/agents";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server-only: agents run here, never in the browser. Provider API keys stay in
 * the server environment, and the client only ever sees the text and the cost.
 */

const smokeAgent = defineAgent({
	id: "smoke",
	tier: "cheap",
	instructions:
		"You are a wiring check for the ET Branding app. Answer in one short sentence.",
	maxSteps: 1,
});

const promptInput = z.object({
	prompt: z.string().min(1).max(2_000),
});

export const runSmokeAgent = createServerFn({ method: "POST" })
	.validator(promptInput)
	.handler(async ({ data }) => {
		const { output, cost } = await smokeAgent.run(data.prompt);
		return {
			modelId: smokeAgent.modelId,
			output,
			usd: cost.usd,
			inputTokens: cost.inputTokens,
			outputTokens: cost.outputTokens,
		};
	});

/** The catalog is safe to expose: ids and published prices, no secrets. */
export const listModels = createServerFn({ method: "GET" }).handler(async () =>
	listModelSpecs().map((spec) => ({
		id: spec.id,
		vendor: spec.vendor,
		usdPerMillionInput: spec.usdPerMillionInput,
		usdPerMillionOutput: spec.usdPerMillionOutput,
		notes: spec.notes ?? null,
	})),
);

export { estimateCost };
