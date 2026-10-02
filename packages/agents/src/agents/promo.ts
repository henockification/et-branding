import {
	defaultLanguage,
	type Language,
	type PromoKind,
	voiceoverWordLimit,
} from "@et/core";
import { generateObject } from "ai";
import { z } from "zod";
import { type CallCost, estimateCost } from "../cost.ts";
import { getModelSpec, isModelId, type ModelId } from "../models/catalog.ts";
import { assertModelUsable, resolveModel } from "../models/registry.ts";
import type { BrandContext } from "./content.ts";

/**
 * Writes the brief. Not the cheapest vision model: Flash-Lite let the
 * workspace's brand profile replace the product in the photos (a coffee bag
 * became "the PulsEvent registration device") and dropped the requester's
 * direction. A brief costs a fraction of a cent on either.
 */
const PROMO_BRIEF_MODEL: ModelId = "google/gemini-2.5-flash";

function resolveBriefModelId(): ModelId {
	const override = process.env.ET_PROMO_MODEL;
	if (!override) return PROMO_BRIEF_MODEL;
	if (!isModelId(override) || !getModelSpec(override).seesImages) {
		throw new Error(
			`ET_PROMO_MODEL="${override}" is not a catalog model that accepts images.`,
		);
	}
	return override;
}

const promoBriefSchema = z.object({
	/**
	 * Every distinct element of the requester's direction, listed before the
	 * prompts are written so none is dropped. Empty when there is none.
	 */
	directionElements: z.array(z.string()).max(20),
	/** What the product is and looks like, from the photos. */
	productDescription: z.string().min(10).max(800),
	/** 1-based index of the photo that shows the product most completely. */
	heroPhoto: z.number().int().min(1),
	/**
	 * A single still of the product in the scene. For videos it is also the
	 * opening frame, so it shows the scene as the clip begins.
	 */
	imagePrompt: z.string().min(20).max(1500),
	/** The clip, starting from that still: what moves and how the camera moves. */
	videoPrompt: z.string().min(20).max(1500),
	/** Spoken words only, no stage directions. */
	voiceoverScript: z.string().max(600),
});

export type PromoBrief = Omit<
	z.infer<typeof promoBriefSchema>,
	"directionElements"
> & {
	cost: CallCost;
	modelId: string;
};

/**
 * Looks at a product's photos and writes the brief every promo is made from:
 * what the product is, the prompts for the image and video models, and a
 * voiceover sized to the clip.
 *
 * Order of authority, highest first: the product (its photos and name), the
 * requester's direction, then the brand — which only sets tone. The brand is
 * the seller, never the subject.
 */
export async function writePromoBrief(options: {
	/** JPEG previews of the product photos, ~1024px. */
	images: readonly { bytes: Uint8Array; mediaType: string }[];
	product: { name: string; notes?: string | null };
	brand: Pick<BrandContext, "name" | "summary" | "voice" | "audience">;
	kind: PromoKind;
	aspectRatio: string;
	durationSecs?: number;
	/** What the requester asked for: the scene, mood, an offer. Binding. */
	request?: string | null;
	language?: Language;
}): Promise<PromoBrief> {
	const modelId = resolveBriefModelId();
	assertModelUsable(modelId);

	const language = options.language ?? defaultLanguage();
	const seconds = options.durationSecs ?? 8;
	const maxWords = voiceoverWordLimit(language.code, seconds);
	const direction = options.request?.trim();
	const isVideo = options.kind !== "image";

	const result = await generateObject({
		model: resolveModel(modelId),
		schema: promoBriefSchema,
		system: [
			"You brief AI image and video models to make an advertisement for ONE product.",
			"",
			"THE PRODUCT is defined only by its name and the attached photos. It is the subject of every prompt. Describe it from the photos: packaging, colours, label, logo.",
			"",
			"THE REQUESTER'S DIRECTION, when given, is binding. It is the scene. First list each distinct element of it in directionElements (setting, props, light, camera move, mood, sound). Then write the prompts so that every listed element appears, in the requester's own words where possible. You may add detail (lens, composition, texture) but never drop, replace or contradict an element. With no direction, invent a fitting scene.",
			"",
			`THE SELLER is ${options.brand.name}. Use what follows only for tone and audience. Never put the seller's own services, devices, software, screens or logo into the prompts unless they are visible in the product photos.`,
			options.brand.summary ? `Seller: ${options.brand.summary}` : "",
			options.brand.voice
				? `Seller's voice: ${JSON.stringify(options.brand.voice)}`
				: "",
			options.brand.audience
				? `Audience: ${JSON.stringify(options.brand.audience)}`
				: "",
			"",
			"Rules for every prompt:",
			"- The product stays exactly as photographed: same shape, colours, label, logo and packaging text. Say so explicitly. Never invent claims, prices or text.",
			"- Concrete and visual, one paragraph, no lists.",
			`- Frame for ${options.aspectRatio}.`,
			"- No people's faces unless the direction asks for them.",
			"",
			"heroPhoto: the 1-based number of the photo that shows the product most completely — its packaging and label if it has them, rather than loose contents.",
			isVideo
				? "imagePrompt: the still the video OPENS on — the product placed in the full scene, as the first moment of the clip. The video model starts from exactly this picture, so everything the scene needs must already be in it."
				: "imagePrompt: a single advertising still of the product in the scene.",
			isVideo
				? `videoPrompt: a ${seconds}-second clip starting from that still. Describe what moves (mist, steam, light) and the camera move from the direction (default: a slow push-in ending sharp on the product). One continuous shot; the product never changes.`
				: "videoPrompt: a short description of the same scene in motion (unused for stills, keep it brief).",
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
							`PRODUCT: ${options.product.name} (${options.images.length} photo${options.images.length === 1 ? "" : "s"} attached, numbered in order)`,
							options.product.notes?.trim()
								? `About the product: ${options.product.notes.trim()}`
								: "",
							direction
								? `DIRECTION (binding — every element must appear):\n${direction}`
								: "DIRECTION: none given.",
						]
							.filter(Boolean)
							.join("\n\n"),
					},
				],
			},
		],
		temperature: 0.4,
	});

	const { directionElements: _elements, ...brief } = result.object;
	return {
		...brief,
		heroPhoto: Math.min(Math.max(brief.heroPhoto, 1), options.images.length),
		voiceoverScript:
			options.kind === "video_voice" ? brief.voiceoverScript.trim() : "",
		cost: estimateCost(modelId, result.usage),
		modelId,
	};
}
