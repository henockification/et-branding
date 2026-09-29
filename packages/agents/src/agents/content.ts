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
	/**
	 * Drafts a human threw out, and why.
	 *
	 * Only rejections with a stated reason are useful: "no" on its own says
	 * something was wrong without saying what, and a list of rejected posts with
	 * no explanation would teach the model to avoid their *subjects* rather than
	 * their faults.
	 */
	rejections?: readonly { body: string; reason: string }[];
};

export type DraftRequest = {
	brand: BrandContext;
	/** What the human asked for, in their own words. */
	brief: string;
	language?: Language;
	/** When the post goes out with a photo: what is in it, as the vision step read it. */
	photo?: { description: string; visibleText?: string };
};

/**
 * The user turn for a photo post.
 *
 * The writer never sees the image, only this account of it. The instruction not
 * to narrate the photo matters: without it the model opens with "In this
 * photo…", which nobody posting their own picture would ever write.
 */
function photoBrief(
	brief: string,
	photo: NonNullable<DraftRequest["photo"]>,
): string {
	return [
		"This post goes out with a photo. What is in it:",
		photo.description,
		...(photo.visibleText?.trim()
			? [`Text visible in the photo: ${photo.visibleText.trim()}`]
			: []),
		"",
		brief.trim()
			? `What they want the post to say: ${brief.trim()}`
			: "They sent the photo without a caption — write the post it deserves.",
		"",
		"The reader sees the photo above your words. Do not describe it back to them, and never write 'in this photo'. Only state what is in the photo or the brief.",
	].join("\n");
}

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

	const rejections =
		brand.rejections && brand.rejections.length > 0
			? [
					"",
					"Drafts a human threw out, with their reason. Avoid the same faults:",
					...brand.rejections.flatMap((rejection) => [
						`- Rejected: ${rejection.body}`,
						`  Because: ${rejection.reason}`,
					]),
				]
			: [];

	return [
		`You are a social media copywriter for ${brand.name}.`,
		"",
		...facts,
		...examples,
		...rejections,
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

	const { output, cost } = await agent.run(
		request.photo ? photoBrief(request.brief, request.photo) : request.brief,
	);

	return {
		output: output.trim(),
		cost,
		modelId: agent.modelId,
		language,
	};
}

/** The one-tap refinements offered under every draft. */
export const REFINEMENT_INSTRUCTIONS = {
	again:
		"Write a different post for the same brief. Take a genuinely different angle — do not reword what is below.",
	shorter:
		"Cut this down. Same point, fewer words. Remove anything decorative.",
	cta: "Keep this as it is, and end it with a clear, specific ask in the brand's voice.",
} as const;

export type RefinementKind = keyof typeof REFINEMENT_INSTRUCTIONS;

/**
 * Rewrites an existing draft.
 *
 * Reuses `instructionsFor` verbatim so the brand's voice rules stay in the
 * system block: a refinement narrows the request, it never overrides the brand.
 * That also keeps the cacheable prefix identical to a first draft — the
 * previous body and the instruction go in the user turn, where they belong.
 */
export async function refinePost(request: {
	brand: BrandContext;
	previousBody: string;
	/** A preset, or whatever a human typed as a reply. */
	instruction: string;
	language?: Language;
}): Promise<Draft> {
	const language = request.language ?? defaultLanguage();

	const agent = defineAgent({
		id: "content",
		tier: "cheap",
		instructions: instructionsFor(request.brand, language),
		maxSteps: 1,
		temperature: 0.8,
	});

	const { output, cost } = await agent.run(
		[
			"Here is the current draft:",
			"",
			request.previousBody,
			"",
			request.instruction,
			"",
			"Reply with the new post only.",
		].join("\n"),
	);

	return {
		output: output.trim(),
		cost,
		modelId: agent.modelId,
		language,
	};
}
