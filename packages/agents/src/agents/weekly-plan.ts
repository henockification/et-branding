import { defaultLanguage, type Language } from "@et/core";
import { generateObject } from "ai";
import { z } from "zod";
import type { CallCost } from "../cost.ts";
import { estimateCost } from "../cost.ts";
import {
	assertModelUsable,
	resolveModel,
	resolveModelId,
} from "../models/registry.ts";
import type { BrandContext } from "./content.ts";

export const WEEKDAYS = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
] as const;

const plannedPostSchema = z.object({
	day: z.enum(WEEKDAYS),
	/** One line on why this post exists, for the human deciding. */
	angle: z.string().min(3).max(200),
	/** The draft itself, ready to approve. */
	body: z.string().min(10).max(1200),
});

const weekPlanSchema = z.object({
	posts: z.array(plannedPostSchema).min(3).max(5),
});

export type PlannedPost = z.infer<typeof plannedPostSchema>;

export type WeekPlan = {
	posts: PlannedPost[];
	cost: CallCost;
	modelId: string;
	language: Language;
};

/**
 * Plans a week of posts.
 *
 * Structured output rather than prose: each post becomes its own approvable
 * draft, so the model has to commit to discrete items instead of returning an
 * essay someone then has to split up.
 *
 * Runs on the balanced tier. Planning is once a week and shapes everything
 * posted after it, which is a different economy from drafting a single caption
 * — and a weak plan wastes a human's whole week, not one approval.
 */
export async function planWeek(options: {
	brand: BrandContext;
	/** Posts already published or approved recently, so the plan does not repeat them. */
	recent?: readonly string[];
	language?: Language;
	weekStarting: Date;
}): Promise<WeekPlan> {
	const language = options.language ?? defaultLanguage();
	const modelId = resolveModelId("balanced");
	assertModelUsable(modelId);

	const recent =
		options.recent && options.recent.length > 0
			? [
					"",
					"Already posted recently — do not repeat these, and do not rephrase them:",
					...options.recent.map((post) => `- ${post}`),
				]
			: [];

	const brandFacts = [
		`Brand: ${options.brand.name}`,
		options.brand.summary ? `What it is: ${options.brand.summary}` : null,
		options.brand.voice
			? `Voice: ${JSON.stringify(options.brand.voice)}`
			: null,
		options.brand.audience
			? `Audience: ${JSON.stringify(options.brand.audience)}`
			: null,
		options.brand.services
			? `Services: ${JSON.stringify(options.brand.services)}`
			: null,
	].filter((line): line is string => line !== null);

	const result = await generateObject({
		model: resolveModel(modelId),
		schema: weekPlanSchema,
		system: [
			`You plan a week of social media posts for ${options.brand.name}.`,
			"",
			...brandFacts,
			...recent,
			"",
			`Write every post in ${language.promptName}.`,
			"",
			"Rules:",
			"- Three to five posts. A quiet week beats a noisy one.",
			"- Vary the purpose: something useful, something human, something that asks for business. Not five adverts.",
			"- Each post must stand on its own. No 'part 2 of'.",
			"- Do not invent facts: no dates, prices, venues, names or numbers you were not given.",
			"- Keep each post short enough to read on a phone without tapping 'more'.",
		].join("\n"),
		prompt: `Plan the week beginning ${options.weekStarting.toISOString().slice(0, 10)}.`,
		temperature: 0.9,
	});

	return {
		posts: result.object.posts,
		cost: estimateCost(modelId, result.usage),
		modelId,
		language,
	};
}

/** Monday of the week containing `date`, at midnight UTC. */
export function weekStart(date: Date): Date {
	const monday = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
	// getUTCDay: 0 is Sunday, so Sunday belongs to the week that began six days ago.
	const offset = (monday.getUTCDay() + 6) % 7;
	monday.setUTCDate(monday.getUTCDate() - offset);
	return monday;
}
