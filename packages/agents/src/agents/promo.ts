import {
	defaultLanguage,
	type Language,
	type PromoKind,
	voiceoverWordLimit,
} from "@et/core";
import { generateObject } from "ai";
import { z } from "zod";
import { type CallCost, estimateCost } from "../cost.ts";
import {
	assertModelUsable,
	resolveModel,
	resolveVisionModelId,
} from "../models/registry.ts";
import type { BrandContext } from "./content.ts";

const promoBriefSchema = z.object({
	/** What the product is and looks like, from the photos. */
	productDescription: z.string().min(10).max(800),
	/** For a still: scene, light, composition — with the product unchanged. */
	imagePrompt: z.string().min(20).max(1500),
	/** For a clip: the same, plus how the camera and the scene move. */
	videoPrompt: z.string().min(20).max(1500),
	/** Spoken words only, no stage directions. */
	voiceoverScript: z.string().max(600),
});

export type PromoBrief = z.infer<typeof promoBriefSchema> & {
	cost: CallCost;
	modelId: string;
};

/**
 * Looks at a product's photos and writes the brief every promo is made from:
 * what the product is, the prompts for the image and video models, and a
 * voiceover sized to the clip.
 *
 * One call for all of it, so the image, the video and the voice tell the same
 * story. The media models never see the brand; this is where the brand gets
 * in.
 */
export async function writePromoBrief(options: {
	/** JPEG previews of the product photos, ~1024px. */
	images: readonly { bytes: Uint8Array; mediaType: string }[];
	product: { name: string; notes?: string | null };
	brand: Pick<BrandContext, "name" | "summary" | "voice" | "audience">;
	kind: PromoKind;
	aspectRatio: string;
	durationSecs?: number;
	/** What the requester asked for this time: mood, setting, an offer. */
	request?: string | null;
	language?: Language;
}): Promise<PromoBrief> {
	const modelId = resolveVisionModelId();
	assertModelUsable(modelId);

	const language = options.language ?? defaultLanguage();
	const seconds = options.durationSecs ?? 8;
	const maxWords = voiceoverWordLimit(language.code, seconds);

	const result = await generateObject({
		model: resolveModel(modelId),
		schema: promoBriefSchema,
		system: [
			`You are the creative director for ${options.brand.name}, briefing AI image and video models to make a promo for one of their products.`,
			options.brand.summary ? `What they do: ${options.brand.summary}` : "",
			options.brand.voice
				? `Brand voice: ${JSON.stringify(options.brand.voice)}`
				: "",
			options.brand.audience
				? `Audience: ${JSON.stringify(options.brand.audience)}`
				: "",
			"",
			"The photos show the real product. The models will receive them as references.",
			"",
			"Rules for every prompt:",
			"- The product must stay exactly as photographed: same shape, colours, label, logo and packaging text. Say so explicitly in each prompt. Never invent claims, prices or text that is not on the product or in the request.",
			"- Describe a scene that sells it to this audience: setting, props, lighting, lens and mood. Concrete and visual, one paragraph, no lists.",
			`- Frame for ${options.aspectRatio}.`,
			"- No people's faces unless the request asks for them.",
			"",
			`imagePrompt: a single advertising still.`,
			`videoPrompt: a ${seconds}-second clip. Open on the product, then describe camera movement (slow push-in, orbit, reveal) and what moves in the scene. One continuous shot.`,
			options.kind === "video_voice"
				? `voiceoverScript: in ${language.promptName}, at most ${maxWords} words so it fits ${seconds} seconds. Spoken words only — no stage directions, no emoji, no hashtags. End on the product name or a short call to action.`
				: "voiceoverScript: leave empty.",
			options.kind === "video_voice"
				? "videoPrompt must not include anyone speaking on screen; the voice is a narrator over the footage."
				: "",
			options.kind === "video_voice" && language.code === "am"
				? "Write the voiceover in natural, spoken Amharic in Ge'ez script, the way an Ethiopian radio ad sounds — not a word-for-word translation. Keep the product's own name as it appears on the label. All other fields stay in English."
				: "",
		]
			.filter((line) => line !== "")
			.join("\n"),
		messages: [
			{
				role: "user",
				content: [
					...options.images.map((image) => ({
						type: "image" as const,
						image: image.bytes,
						mediaType: image.mediaType,
					})),
					{
						type: "text" as const,
						text: [
							`Product: ${options.product.name}`,
							options.product.notes?.trim()
								? `About it: ${options.product.notes.trim()}`
								: "",
							options.request?.trim()
								? `This time they asked for: ${options.request.trim()}`
								: "",
						]
							.filter(Boolean)
							.join("\n"),
					},
				],
			},
		],
		temperature: 0.7,
	});

	return {
		...result.object,
		voiceoverScript:
			options.kind === "video_voice"
				? result.object.voiceoverScript.trim()
				: "",
		cost: estimateCost(modelId, result.usage),
		modelId,
	};
}
