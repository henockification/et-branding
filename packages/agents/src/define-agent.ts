import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import { type CallCost, estimateCost } from "./cost.ts";
import type { ModelId, ModelTier } from "./models/catalog.ts";
import {
	assertModelUsable,
	resolveModel,
	resolveModelId,
} from "./models/registry.ts";

export type AgentDefinition<TOOLS extends ToolSet> = {
	/** Stable id used for logging and cost attribution. */
	readonly id: string;
	/** System prompt. Keep it stable — a stable prefix is what prompt caching bills cheaply. */
	readonly instructions: string;
	/**
	 * How much this agent's work is worth spending on. Prefer a tier over a
	 * model id so the whole app can be re-pointed at a cheaper provider at once.
	 */
	readonly tier: ModelTier;
	/** Pin a specific catalog model when the tier default genuinely will not do. */
	readonly modelId?: ModelId;
	readonly tools?: TOOLS;
	/** Hard ceiling on tool-loop steps. Guards against runaway spend. */
	readonly maxSteps?: number;
	readonly temperature?: number;
};

export type AgentRun<T> = {
	readonly output: T;
	readonly cost: CallCost;
};

export type DefinedAgent = {
	readonly id: string;
	readonly modelId: ModelId;
	/** Run the agent on a prompt and report what it cost. */
	run(prompt: string): Promise<AgentRun<string>>;
	/** The underlying AI SDK agent, for streaming or anything bespoke. */
	readonly agent: ToolLoopAgent<never, ToolSet>;
};

/**
 * Wrap an AI SDK agent so that every agent in the app is declared the same way
 * and every call reports its own cost. Nothing here is Anthropic-specific: the
 * model arrives from the registry, so DeepSeek and OpenAI are drop-in.
 */
export function defineAgent<TOOLS extends ToolSet>(
	definition: AgentDefinition<TOOLS>,
): DefinedAgent {
	const modelId = resolveModelId(definition.modelId ?? definition.tier);

	const agent = new ToolLoopAgent({
		id: definition.id,
		model: resolveModel(definition.modelId ?? definition.tier),
		instructions: definition.instructions,
		tools: (definition.tools ?? {}) as ToolSet,
		temperature: definition.temperature,
		stopWhen: stepCountIs(definition.maxSteps ?? 8),
	});

	return {
		id: definition.id,
		modelId,
		agent,
		async run(prompt) {
			assertModelUsable(modelId);
			const result = await agent.generate({ prompt });
			return {
				output: result.text,
				cost: estimateCost(modelId, result.totalUsage),
			};
		},
	};
}
