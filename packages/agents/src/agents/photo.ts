import { generateObject } from "ai";
import { z } from "zod";
import { type CallCost, estimateCost } from "../cost.ts";
import {
	assertModelUsable,
	resolveModel,
	resolveVisionModelId,
} from "../models/registry.ts";
import type { BrandContext } from "./content.ts";

/**
 * The edits a careful person would make on their phone, and nothing else.
 *
 * Every field maps one-to-one onto a Cloudflare Images transform. There is no
 * generative step anywhere: pixels are adjusted, never invented, so a face, a
 * logo or the words on a banner come out exactly as they went in.
 */
export type PhotoAdjustments = {
	/** 1 leaves it alone. Above 1 lifts exposure. */
	brightness: number;
	contrast: number;
	/** Cloudflare's gamma: above 1 lifts the midtones, below 1 darkens them. */
	gamma: number;
	saturation: number;
	/** 0 is none. Cloudflare's scale runs to 10; anything past ~1.5 looks processed. */
	sharpen: number;
	/** Only to fix a photo that is on its side. Never for effect. */
	rotate: 0 | 90 | 180 | 270;
	/** Social-feed shapes. "none" keeps the photographer's framing. */
	crop: "none" | "4:5" | "1:1";
};

/**
 * How far any edit may go, whatever the model asks for.
 *
 * This is where "not AI-looking" is actually enforced. A prompt can be ignored;
 * a clamp cannot. The bands are narrow on purpose — at their edges the change is
 * visible side by side and invisible on its own, which is the brief.
 */
export const ADJUSTMENT_LIMITS = {
	brightness: { min: 0.92, max: 1.12 },
	contrast: { min: 0.95, max: 1.12 },
	gamma: { min: 0.9, max: 1.1 },
	saturation: { min: 0.95, max: 1.1 },
	sharpen: { min: 0, max: 1.5 },
} as const;

export const NEUTRAL_ADJUSTMENTS: PhotoAdjustments = {
	brightness: 1,
	contrast: 1,
	gamma: 1,
	saturation: 1,
	sharpen: 0,
	rotate: 0,
	crop: "none",
};

function clamp(value: number, limits: { min: number; max: number }): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(Math.max(value, limits.min), limits.max);
}

/** Pulls whatever the model proposed back inside the limits. */
export function clampAdjustments(proposed: PhotoAdjustments): PhotoAdjustments {
	const round = (value: number) => Math.round(value * 100) / 100;

	return {
		brightness: round(clamp(proposed.brightness, ADJUSTMENT_LIMITS.brightness)),
		contrast: round(clamp(proposed.contrast, ADJUSTMENT_LIMITS.contrast)),
		gamma: round(clamp(proposed.gamma, ADJUSTMENT_LIMITS.gamma)),
		saturation: round(clamp(proposed.saturation, ADJUSTMENT_LIMITS.saturation)),
		sharpen: round(
			Number.isFinite(proposed.sharpen)
				? clamp(proposed.sharpen, ADJUSTMENT_LIMITS.sharpen)
				: 0,
		),
		rotate: proposed.rotate,
		crop: proposed.crop,
	};
}

/** True when the edit would change nothing, so there is no point applying it. */
export function isNeutral(adjustments: PhotoAdjustments): boolean {
	return (
		adjustments.brightness === 1 &&
		adjustments.contrast === 1 &&
		adjustments.gamma === 1 &&
		adjustments.saturation === 1 &&
		adjustments.sharpen === 0 &&
		adjustments.rotate === 0 &&
		adjustments.crop === "none"
	);
}

const photoReadingSchema = z.object({
	/** What is actually in the frame, for the copywriter who cannot see it. */
	description: z.string().min(10).max(600),
	/** Words legible in the photo — banners, signs, slides. Empty if none. */
	visibleText: z.string().max(300),
	/** Whether faces are the point of the photo; decides crop gravity. */
	peopleAreTheSubject: z.boolean(),
	adjustments: z.object({
		brightness: z.number(),
		contrast: z.number(),
		gamma: z.number(),
		saturation: z.number(),
		sharpen: z.number(),
		rotate: z.union([
			z.literal(0),
			z.literal(90),
			z.literal(180),
			z.literal(270),
		]),
		crop: z.enum(["none", "4:5", "1:1"]),
	}),
});

export type PhotoReading = {
	description: string;
	visibleText: string;
	peopleAreTheSubject: boolean;
	/** Already clamped. Safe to apply as-is. */
	adjustments: PhotoAdjustments;
	/** What the model asked for before clamping — kept for tuning the limits. */
	proposed: PhotoAdjustments;
	cost: CallCost;
	modelId: string;
};

/**
 * Looks at a photo once and answers two questions: what is in it, and what
 * light edit would make it look its best.
 *
 * One call rather than two because both answers come from the same look, and
 * the image is the expensive part of the prompt.
 *
 * Only this step sees the image. The post itself is still written by the
 * brand's usual model from `description`, so photo posts keep the same voice
 * and language as every other draft.
 */
export async function readPhoto(options: {
	/** JPEG bytes. Send a downscaled preview — detail beyond ~1024px buys nothing here. */
	image: Uint8Array;
	mediaType: string;
	/** What the person said about it, if anything. */
	caption?: string;
	brand: Pick<BrandContext, "name" | "summary">;
}): Promise<PhotoReading> {
	const modelId = resolveVisionModelId();
	assertModelUsable(modelId);

	const limits = Object.entries(ADJUSTMENT_LIMITS)
		.map(([name, { min, max }]) => `${name} ${min}–${max}`)
		.join(", ");

	const result = await generateObject({
		model: resolveModel(modelId),
		schema: photoReadingSchema,
		system: [
			`You help ${options.brand.name} post photos taken on a phone at events and at work.`,
			options.brand.summary ? `What they do: ${options.brand.summary}` : "",
			"",
			"You do two things with each photo.",
			"",
			"1. Describe it for a copywriter who cannot see it: who or what is in it, what is happening, the setting and the mood. Plain facts only. Do not guess names, dates or places that are not visible. Copy any legible text exactly into visibleText.",
			"",
			"2. Choose a light edit, the way a careful person would on their phone before posting. The result must look like a good photo, never like an edited one.",
			`   - Values are multipliers where 1 means unchanged; above 1 is brighter, punchier or more colourful. sharpen is 0 for none. Allowed ranges: ${limits}.`,
			"   - Fix what is wrong and leave the rest: lift a dim indoor shot, add a touch of contrast to a flat one, sharpen slightly if soft.",
			"   - A photo that already looks right gets 1, 1, 1, 1, 0. That is a good answer.",
			"   - rotate only if the photo is clearly on its side or upside down.",
			'   - crop "4:5" suits most feed posts; use "none" if cropping would cut off people, a banner or anything important at the edges.',
		]
			.filter((line) => line !== "")
			.join("\n"),
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						image: options.image,
						mediaType: options.mediaType,
					},
					{
						type: "text",
						text: options.caption?.trim()
							? `The person sending it said: ${options.caption.trim()}`
							: "The person sent no caption.",
					},
				],
			},
		],
		// Judgement about exposure should be repeatable, not creative.
		temperature: 0.2,
	});

	const proposed = result.object.adjustments;

	return {
		description: result.object.description,
		visibleText: result.object.visibleText,
		peopleAreTheSubject: result.object.peopleAreTheSubject,
		adjustments: clampAdjustments(proposed),
		proposed,
		cost: estimateCost(modelId, result.usage),
		modelId,
	};
}
