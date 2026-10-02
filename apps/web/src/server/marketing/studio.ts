import {
	PROMO_ASPECT_RATIOS,
	PROMO_DURATIONS,
	PROMO_KINDS,
	PROMO_VOICE_LANGUAGES,
	type PromoDuration,
	promoCreditCost,
	VIDEO_ASPECT_RATIOS,
} from "@et/core";
import {
	and,
	desc,
	eq,
	getDb,
	marketingGeneration,
	marketingProduct,
	organization,
	sql,
} from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fail } from "#/server/errors";
import {
	AZURE_AMHARIC_VOICES,
	isAzureSpeechConfigured,
} from "#/server/marketing/azure-speech";
import { refreshRendering, runPipeline } from "#/server/marketing/pipeline";
import {
	isMediaProviderConfigured,
	isVoiceConfigured,
	listVoices,
} from "#/server/marketing/provider";
import { deleteMedia } from "#/server/media";
import {
	readModuleAccess,
	refundCredits,
	requireModule,
	spendCredits,
} from "#/server/modules";

/**
 * Marketing Studio's server functions: products, promos and voices.
 * Photo uploads come in through `routes/api/marketing/products.ts`, since
 * they are multipart.
 */

const orgIdSchema = z.object({ orgId: z.string().uuid() });

export const fetchMarketingHome = createServerFn({ method: "GET" })
	.validator(orgIdSchema)
	.handler(async ({ data }) => {
		const allowed = await readModuleAccess(data.orgId, "marketing");
		if (!allowed) return { found: false } as const;
		const db = getDb();

		const [[org], products] = await Promise.all([
			db
				.select({ name: organization.name })
				.from(organization)
				.where(eq(organization.id, data.orgId))
				.limit(1),
			db
				.select({
					id: marketingProduct.id,
					name: marketingProduct.name,
					notes: marketingProduct.notes,
					photos: marketingProduct.photos,
					createdAt: marketingProduct.createdAt,
					promos: sql<number>`(select count(*)::int from ${marketingGeneration} where ${marketingGeneration.productId} = ${marketingProduct.id} and ${marketingGeneration.status} = 'completed')`,
				})
				.from(marketingProduct)
				.where(eq(marketingProduct.orgId, data.orgId))
				.orderBy(desc(marketingProduct.createdAt)),
		]);

		return {
			found: true,
			orgName: org?.name ?? "",
			canEdit: allowed.access.canEdit,
			credits: allowed.state.credits,
			products: products.map(({ photos, ...product }) => ({
				...product,
				photoIds: photos.map((photo) => photo.id),
			})),
		} as const;
	});

export const fetchProduct = createServerFn({ method: "GET" })
	.validator(orgIdSchema.extend({ productId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const allowed = await readModuleAccess(data.orgId, "marketing");
		if (!allowed) return { found: false } as const;
		const db = getDb();

		const [product] = await db
			.select()
			.from(marketingProduct)
			.where(
				and(
					eq(marketingProduct.id, data.productId),
					eq(marketingProduct.orgId, data.orgId),
				),
			)
			.limit(1);
		if (!product) return { found: false } as const;

		// Someone is watching: pick up finished videos now rather than at the
		// next webhook or cron.
		await refreshRendering(product.id);

		const generations = await db
			.select({
				id: marketingGeneration.id,
				kind: marketingGeneration.kind,
				status: marketingGeneration.status,
				settings: marketingGeneration.settings,
				brief: marketingGeneration.brief,
				outputMime: marketingGeneration.outputMime,
				voiceoverKey: marketingGeneration.voiceoverKey,
				externalIds: marketingGeneration.externalIds,
				credits: marketingGeneration.credits,
				error: marketingGeneration.error,
				createdAt: marketingGeneration.createdAt,
				completedAt: marketingGeneration.completedAt,
			})
			.from(marketingGeneration)
			.where(eq(marketingGeneration.productId, product.id))
			.orderBy(desc(marketingGeneration.createdAt))
			.limit(50);

		return {
			found: true,
			canEdit: allowed.access.canEdit,
			credits: allowed.state.credits,
			providerReady: isMediaProviderConfigured(),
			product: {
				id: product.id,
				name: product.name,
				notes: product.notes,
				photoIds: product.photos.map((photo) => photo.id),
			},
			// Which voiceover languages can be offered: English through
			// ElevenLabs, Amharic through Azure.
			voiceReady: { en: isVoiceConfigured(), am: isAzureSpeechConfigured() },
			generations: generations.map(
				({ brief, voiceoverKey, externalIds, ...generation }) => ({
					...generation,
					hasVoiceover: Boolean(voiceoverKey),
					hasOpeningFrame: Boolean(externalIds.heroKey),
					// The requester sees the voiceover, not the prompts behind it.
					voiceoverScript: brief?.voiceoverScript || null,
				}),
			),
		} as const;
	});

export const fetchVoices = createServerFn({ method: "GET" })
	.validator(
		orgIdSchema.extend({
			language: z.enum(PROMO_VOICE_LANGUAGES).default("en"),
		}),
	)
	.handler(async ({ data }) => {
		await requireModule(data.orgId, "marketing", "read");

		if (data.language === "am") {
			if (!isAzureSpeechConfigured()) return [];
			return AZURE_AMHARIC_VOICES.map((voice) => ({
				id: voice.id,
				name: voice.name,
				description: voice.description,
				previewUrl: null,
			}));
		}

		if (!isVoiceConfigured()) return [];

		const voices = await listVoices();
		return voices.map((voice) => ({
			id: voice.voice_id,
			name: voice.name,
			description: [
				voice.labels?.gender,
				voice.labels?.accent,
				voice.labels?.age,
			]
				.filter(Boolean)
				.join(", "),
			previewUrl: voice.preview_url ?? null,
		}));
	});

const startSchema = orgIdSchema
	.extend({
		productId: z.string().uuid(),
		kind: z.enum(PROMO_KINDS),
		aspectRatio: z.enum(PROMO_ASPECT_RATIOS),
		durationSecs: z
			.number()
			.int()
			.refine((n) => (PROMO_DURATIONS as readonly number[]).includes(n))
			.optional(),
		voiceId: z.string().trim().max(100).optional(),
		language: z.enum(PROMO_VOICE_LANGUAGES).optional(),
		notes: z.string().trim().max(500).optional(),
		script: z.string().trim().max(600).optional(),
	})
	.superRefine((value, ctx) => {
		if (value.kind === "image") return;
		if (
			!(VIDEO_ASPECT_RATIOS as readonly string[]).includes(value.aspectRatio)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["aspectRatio"],
				message: `Videos can be ${VIDEO_ASPECT_RATIOS.join(" or ")}.`,
			});
		}
		if (!value.durationSecs) {
			ctx.addIssue({
				code: "custom",
				path: ["durationSecs"],
				message: "Choose a length for the video.",
			});
		}
	});

/**
 * Charges the credits, queues the promo and runs it as far as this request
 * can: an image finishes here; a video is submitted, and the page polls
 * `fetchProduct` while it renders. Not deferred — a Worker cuts deferred
 * work off ~30s after responding, and a brief plus an image can take longer.
 */
export const startGeneration = createServerFn({ method: "POST" })
	.validator(startSchema)
	.handler(async ({ data }) => {
		const { access } = await requireModule(data.orgId, "marketing", "edit");
		if (!isMediaProviderConfigured()) {
			fail("Promo generation is not set up yet. Please try again later.", 503);
		}
		if (
			data.kind === "video_voice" &&
			data.language === "am" &&
			!isAzureSpeechConfigured()
		) {
			fail("Amharic voiceovers are not available yet.", 503);
		}
		const db = getDb();

		const [product] = await db
			.select({ id: marketingProduct.id, photos: marketingProduct.photos })
			.from(marketingProduct)
			.where(
				and(
					eq(marketingProduct.id, data.productId),
					eq(marketingProduct.orgId, data.orgId),
				),
			)
			.limit(1);
		if (!product) fail("Not found.", 404);
		if (product.photos.length === 0)
			fail("Add a photo of the product first.", 400);

		const id = crypto.randomUUID();
		const credits = promoCreditCost(
			data.kind,
			data.kind === "image"
				? undefined
				: (data.durationSecs as PromoDuration | undefined),
		);

		// Charge first: refusing for lack of credits must leave nothing behind.
		await spendCredits({
			orgId: data.orgId,
			module: "marketing",
			amount: credits,
			generationId: id,
			userId: access.viewer.userId,
		});

		try {
			await db.insert(marketingGeneration).values({
				id,
				orgId: data.orgId,
				productId: product.id,
				kind: data.kind,
				settings: {
					aspectRatio: data.aspectRatio,
					durationSecs: data.kind === "image" ? undefined : data.durationSecs,
					voiceId: data.kind === "video_voice" ? data.voiceId : undefined,
					language:
						data.kind === "video_voice" ? (data.language ?? "en") : undefined,
					notes: data.notes || undefined,
					script:
						data.kind === "video_voice" ? data.script || undefined : undefined,
				},
				credits,
				createdBy: access.viewer.userId,
			});
		} catch (error) {
			await refundCredits({
				orgId: data.orgId,
				module: "marketing",
				amount: credits,
				generationId: id,
				note: "Could not queue the generation.",
			});
			throw error;
		}

		await runPipeline(id);

		return { generationId: id, credits };
	});

export const deleteProduct = createServerFn({ method: "POST" })
	.validator(orgIdSchema.extend({ productId: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireModule(data.orgId, "marketing", "edit");
		const db = getDb();

		const outputs = await db
			.select({
				key: marketingGeneration.outputKey,
				voiceover: marketingGeneration.voiceoverKey,
			})
			.from(marketingGeneration)
			.where(
				and(
					eq(marketingGeneration.productId, data.productId),
					eq(marketingGeneration.orgId, data.orgId),
				),
			);

		const [deleted] = await db
			.delete(marketingProduct)
			.where(
				and(
					eq(marketingProduct.id, data.productId),
					eq(marketingProduct.orgId, data.orgId),
				),
			)
			.returning({ photos: marketingProduct.photos });
		if (!deleted) fail("Not found.", 404);

		await deleteMedia([
			...deleted.photos.map((photo) => photo.key),
			...outputs.flatMap((output) =>
				[output.key, output.voiceover].filter((key): key is string => !!key),
			),
		]).catch((error) => {
			// The rows are gone; an orphaned object is untidy, not harmful.
			console.error("marketing: deleting product media failed", error);
		});

		return { deleted: true };
	});
