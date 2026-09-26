import { defaultLanguage, type Language } from "@et/core";
import { type AgentRun, defineAgent } from "../define-agent.ts";

/**
 * What the agent is told about the brand before it is told anything else.
 *
 * This is the structured half of the Brand Brain. The unstructured half —
 * retrieved past posts — will arrive as `examples` once documents are loaded
 * and embeddings exist; the field is here now so adding retrieval does not
 * change this shape.
 */
export type BrandContext = {
	name: string;
	summary?: string | null;
	voice?: Record<string, unknown> | null;
	audience?: Record<string, unknown> | null;
	services?: Record<string, unknown> | null;
	/** Past posts to imitate. Empty until the Brain has documents. */
	examples?: readonly string[];
	/**
	 * Posts a human rewrote: what the agent wrote, and what they changed it to.
	 *
	 * Worth more than an example. A good post shows what the brand sounds like;
	 * a correction shows precisely where this agent went wrong, which is the one
	 * thing an example can never convey.
	 */
	corrections?: readonly { before: string; after: string }[];
};

export type DraftRequest = {
	brand: BrandContext;
	/** What the human asked for, in their own words. */
	brief: string;
	language?: Language;
};

function describe(label: string, value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string")
		return value.trim() ? `${label}: ${value}` : null;

	const json = JSON.stringify(value);
	return json && json !== "{}" && json !== "[]" ? `${label}: ${json}` : null;
}

/**
 * Builds the system prompt.
 *
 * Kept as one stable block per brand so prompt caching can bill it at the
 * cache-read rate: the brand description barely changes between drafts, while
 * the brief changes every time.
 */
function instructionsFor(brand: BrandContext, language: Language): string {
	const facts = [
		describe("Brand", brand.name),
		describe("What it is", brand.summary),
		describe("Voice", brand.voice),
		describe("Audience", brand.audience),
		describe("Services", brand.services),
	].filter((line): line is string => line !== null);

	const examples =
		brand.examples && brand.examples.length > 0
			? [
					"",
					"Past posts from this brand — match their rhythm and register, do not copy them:",
					...brand.examples.map((example) => `- ${example}`),
				]
			: [];

	// Last in the prompt, so it is the most recent instruction before the brief:
	// these are the mistakes this agent actually made for this brand.
	const corrections =
		brand.corrections && brand.corrections.length > 0
			? [
					"",
					"Drafts a human rewrote. Learn the difference — do not repeat what was changed:",
					...brand.corrections.flatMap((correction) => [
						`- You wrote: ${correction.before}`,
						`  They wanted: ${correction.after}`,
					]),
				]
			: [];

	return [
		`You are a social media copywriter for ${brand.name}.`,
		"",
		...facts,
		...examples,
		...corrections,
		"",
		`Write in ${language.promptName}.`,
		"",
		"Rules:",
		"- Return the post text only. No preamble, no explanation, no options.",
		"- Keep it short enough to read on a phone without tapping 'more'.",
		"- Write about outcomes, not about the technology behind them.",
		"- Do not invent facts: no dates, prices, venues or names that were not given to you.",
		"- At most a few hashtags, and only if they earn their place.",
	].join("\n");
}

export type Draft = AgentRun<string> & {
	modelId: string;
	language: Language;
};

/**
 * Drafts one post.
 *
 * The agent is built per call because its instructions carry the brand, and
 * building one is cheap — no network, no state.
 */
export async function draftPost(request: DraftRequest): Promise<Draft> {
	const language = request.language ?? defaultLanguage();

	const agent = defineAgent({
		id: "content",
		tier: "cheap",
		instructions: instructionsFor(request.brand, language),
		// One shot: there are no tools to call yet, so more steps would only
		// give the model room to argue with itself.
		maxSteps: 1,
		temperature: 0.8,
	});

	const { output, cost } = await agent.run(request.brief);

	return {
		output: output.trim(),
		cost,
		modelId: agent.modelId,
		language,
	};
}
