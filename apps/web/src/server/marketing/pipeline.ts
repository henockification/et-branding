import {
	createVideoJob,
	downloadVideo,
	generateImage,
	getVideoJob,
	MediaGenerationError,
	toDataUrl,
	type VideoJob,
	videoJobError,
	writePromoBrief,
} from "@et/agents";
import { enabledLanguages } from "@et/core";
import {
	agentRun,
	and,
	brandProfile,
	eq,
	getDb,
	inArray,
	lte,
	type MarketingGeneration,
	marketingGeneration,
	marketingProduct,
	type PromoBrief,
	type PromoStatus,
} from "@et/db";
import { resolveSpeechModel } from "@et/elevenlabs";
import {
	defaultVoiceId,
	getElevenLabs,
	isVoiceConfigured,
	videoCallbackUrl,
} from "#/server/marketing/provider";
import { getPhoto, marketingKeys, preview, putMedia } from "#/server/media";
import { refundCredits } from "#/server/modules";

/**
 * Turns a queued promo into a stored image or video.
 *
 *   image:         queued → briefing → storing → completed
 *   video:         queued → briefing → rendering → storing → completed
 *   video + voice: queued → briefing → voicing → rendering → storing → completed
 *
 * Everything up to submitting the video runs inside the request that asked
 * for it: a Worker's deferred work is cut off ~30s after the response, and
 * a brief plus an image can take longer. Only `rendering` a video waits on
 * the provider, for minutes; its webhook or the cron poll finishes it, in
 * whichever isolate is running then.
 *
 * Every transition is a conditional UPDATE from the expected status, so a
 * duplicate webhook, a poll racing a webhook, or a retried request can never
 * run a step twice. Any failure refunds the credits.
 */

const AGENT = "promo";

/** Photos the brief agent and the image model look at. */
const MAX_BRIEF_IMAGES = 4;
const MAX_REFERENCE_IMAGES = 6;

/** A video still rendering after this is given up on. */
const RENDER_TIMEOUT_MS = 60 * 60 * 1000;

/** Our own steps only stall if their request died. */
const LOCAL_STEP_TIMEOUT_MS = 15 * 60 * 1000;

/** Leave a fresh video to its webhook before polling it. */
const POLL_AFTER_MS = 2 * 60 * 1000;

const ACTIVE: PromoStatus[] = [
	"queued",
	"briefing",
	"voicing",
	"rendering",
	"storing",
];

/** Words a requester sees; the provider's raw error goes to the logs. */
function userFacingError(error: unknown): string {
	if (error instanceof MediaGenerationError && error.status === 400) {
		return "The media model refused these settings or photos. Try another shape, length or direction.";
	}
	return "Something went wrong while making this promo. Your credits have been returned.";
}

async function transition(
	id: string,
	from: PromoStatus,
	to: PromoStatus,
	fields: Partial<typeof marketingGeneration.$inferInsert> = {},
): Promise<MarketingGeneration | null> {
	const [row] = await getDb()
		.update(marketingGeneration)
		.set({
			...fields,
			status: to,
			stepStartedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(eq(marketingGeneration.id, id), eq(marketingGeneration.status, from)),
		)
		.returning();
	return row ?? null;
}

async function fail(
	row: MarketingGeneration,
	reason: string,
	detail?: unknown,
): Promise<void> {
	console.error(`promo ${row.id}: failed at ${row.status}`, detail ?? reason);

	const [failed] = await getDb()
		.update(marketingGeneration)
		.set({
			status: "failed",
			error: reason,
			pendingExternalId: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(marketingGeneration.id, row.id),
				// Never overwrite an outcome that is already final.
				inArray(marketingGeneration.status, ACTIVE),
			),
		)
		.returning({ id: marketingGeneration.id });
	if (!failed) return;

	await refundCredits({
		orgId: row.orgId,
		module: "marketing",
		amount: row.credits,
		generationId: row.id,
		note: reason,
	});
}

async function reload(id: string): Promise<MarketingGeneration | null> {
	const [row] = await getDb()
		.select()
		.from(marketingGeneration)
		.where(eq(marketingGeneration.id, id))
		.limit(1);
	return row ?? null;
}

/** The product's stored photos, normalised JPEGs, at most `limit`. */
async function productPhotos(
	productId: string,
	limit: number,
): Promise<Uint8Array<ArrayBuffer>[]> {
	const [product] = await getDb()
		.select({ photos: marketingProduct.photos })
		.from(marketingProduct)
		.where(eq(marketingProduct.id, productId))
		.limit(1);

	const jpegs: Uint8Array<ArrayBuffer>[] = [];
	for (const photo of (product?.photos ?? []).slice(0, limit)) {
		const jpeg = await getPhoto(photo.key);
		if (jpeg) jpegs.push(jpeg);
	}
	if (jpegs.length === 0) {
		throw new Error("The product has no photos left to work from.");
	}
	return jpegs;
}

/**
 * Runs a queued generation as far as it can go in this request. Never
 * throws: a failure is recorded on the row and refunded. Safe to call more
 * than once; only the first call gets past `queued`.
 */
export async function runPipeline(id: string): Promise<void> {
	const row = await transition(id, "queued", "briefing");
	if (!row) return;

	try {
		const brief = await writeBrief(row);
		const briefed = { ...row, brief };

		if (row.kind === "image") {
			await renderImage(briefed);
		} else {
			await startVideo(briefed);
		}
	} catch (error) {
		await fail((await reload(id)) ?? row, userFacingError(error), error);
	}
}

/** Looks at the product and writes the prompts and voiceover. */
async function writeBrief(row: MarketingGeneration): Promise<PromoBrief> {
	const db = getDb();
	const [[product], [brand]] = await Promise.all([
		db
			.select()
			.from(marketingProduct)
			.where(eq(marketingProduct.id, row.productId))
			.limit(1),
		db
			.select({
				name: brandProfile.name,
				summary: brandProfile.summary,
				voice: brandProfile.voice,
				audience: brandProfile.audience,
			})
			.from(brandProfile)
			.where(eq(brandProfile.orgId, row.orgId))
			.limit(1),
	]);
	if (!product) throw new Error("The product was deleted.");

	const photos = await productPhotos(row.productId, MAX_BRIEF_IMAGES);
	const previews = await Promise.all(photos.map((jpeg) => preview(jpeg)));

	const [run] = await db
		.insert(agentRun)
		.values({
			orgId: row.orgId,
			agent: AGENT,
			input: {
				generationId: row.id,
				kind: row.kind,
				settings: row.settings,
				photos: previews.length,
			},
			status: "running",
		})
		.returning({ id: agentRun.id });

	try {
		const result = await writePromoBrief({
			images: previews.map((bytes) => ({ bytes, mediaType: "image/jpeg" })),
			product: { name: product.name, notes: product.notes },
			brand: brand ?? { name: product.name },
			kind: row.kind,
			aspectRatio: row.settings.aspectRatio,
			durationSecs: row.settings.durationSecs,
			request: row.settings.notes,
			language: enabledLanguages()[0],
		});

		const { cost, modelId, ...brief } = result;
		// A script the requester wrote wins over the drafted one.
		if (row.settings.script?.trim()) {
			brief.voiceoverScript = row.settings.script.trim();
		}

		if (run) {
			await db
				.update(agentRun)
				.set({
					modelId,
					output: brief,
					inputTokens: cost.inputTokens,
					outputTokens: cost.outputTokens,
					usd: cost.usd.toFixed(6),
					status: "succeeded",
					finishedAt: new Date(),
				})
				.where(eq(agentRun.id, run.id));
		}

		await db
			.update(marketingGeneration)
			.set({ brief, agentRunId: run?.id ?? null, updatedAt: new Date() })
			.where(eq(marketingGeneration.id, row.id));

		return brief;
	} catch (error) {
		if (run) {
			await db
				.update(agentRun)
				.set({
					status: "failed",
					error: error instanceof Error ? error.message : String(error),
					finishedAt: new Date(),
				})
				.where(eq(agentRun.id, run.id));
		}
		throw error;
	}
}

/** An image is synchronous: render, store, done. */
async function renderImage(row: MarketingGeneration): Promise<void> {
	// biome-ignore lint/style/noNonNullAssertion: set by the brief step.
	const brief = row.brief!;
	const photos = await productPhotos(row.productId, MAX_REFERENCE_IMAGES);

	const image = await generateImage({
		prompt: brief.imagePrompt,
		aspectRatio: row.settings.aspectRatio,
		references: photos.map((jpeg) => toDataUrl(jpeg, "image/jpeg")),
	});

	const claimed = await transition(row.id, "briefing", "storing");
	if (!claimed) return;

	const extension = image.mediaType === "image/jpeg" ? "jpg" : "png";
	const key = marketingKeys.output(row.orgId, row.id, extension);
	await putMedia(key, image.bytes, image.mediaType);

	await transition(row.id, "storing", "completed", {
		outputKey: key,
		outputMime: image.mediaType,
		providerCost: image.usd.toFixed(6),
		completedAt: new Date(),
	});
}

/** Records the voiceover MP3 (video + voice), then submits the video. */
async function startVideo(row: MarketingGeneration): Promise<void> {
	// biome-ignore lint/style/noNonNullAssertion: set by the brief step.
	const brief = row.brief!;
	let from: PromoStatus = "briefing";

	if (row.kind === "video_voice") {
		if (!brief.voiceoverScript) {
			throw new Error("The voiceover script is empty.");
		}
		if (!(await transition(row.id, "briefing", "voicing"))) return;
		from = "voicing";

		const voice = row.settings.voiceId || defaultVoiceId();
		if (isVoiceConfigured() && voice) {
			try {
				const mp3 = await getElevenLabs().textToSpeech({
					voiceId: voice,
					text: brief.voiceoverScript,
					modelId: resolveSpeechModel(),
				});
				const key = marketingKeys.voiceover(row.orgId, row.id);
				await putMedia(key, mp3, "audio/mpeg");
				await getDb()
					.update(marketingGeneration)
					.set({ voiceoverKey: key, updatedAt: new Date() })
					.where(eq(marketingGeneration.id, row.id));
			} catch (error) {
				// The video narrates the script itself; the MP3 is a bonus, not
				// worth failing the promo over.
				console.error(`promo ${row.id}: voiceover MP3 failed`, error);
			}
		}
	}

	const [firstPhoto] = await productPhotos(row.productId, 1);
	if (!firstPhoto) throw new Error("The product has no photos.");

	const prompt =
		row.kind === "video_voice"
			? `${brief.videoPrompt}\n\nA warm, clear narrator voiceover (nobody on screen speaks) says: "${brief.voiceoverScript}" Soft background music under the voice.`
			: `${brief.videoPrompt}\n\nSound: fitting background music and natural ambient sound. No speech.`;

	const job = await createVideoJob({
		prompt,
		durationSecs: row.settings.durationSecs ?? 8,
		aspectRatio: row.settings.aspectRatio,
		firstFrame: toDataUrl(firstPhoto, "image/jpeg"),
		generateAudio: true,
		callbackUrl: videoCallbackUrl(),
	});

	await transition(row.id, from, "rendering", {
		externalIds: { video: job.id },
		pendingExternalId: job.id,
	});
}

/**
 * Moves a rendering video on, given the provider's latest word on it.
 * Called by the webhook and the poll alike; whichever comes second finds the
 * status already changed and does nothing.
 */
export async function advance(
	row: MarketingGeneration,
	job: VideoJob,
): Promise<void> {
	if (row.status !== "rendering" || job.id !== row.pendingExternalId) return;
	if (job.status === "pending" || job.status === "in_progress") return;

	if (job.status !== "completed") {
		await fail(
			row,
			"The video model could not make this promo. Your credits have been returned.",
			videoJobError(job),
		);
		return;
	}

	const url = job.unsigned_urls?.[0];
	if (!url) {
		await fail(row, userFacingError(null), "Completed job had no URL.");
		return;
	}

	const claimed = await transition(row.id, "rendering", "storing", {
		pendingExternalId: null,
	});
	if (!claimed) return;

	try {
		const download = await downloadVideo(url);
		const key = marketingKeys.output(row.orgId, row.id, "mp4");
		await putMedia(key, download, "video/mp4");

		await transition(row.id, "storing", "completed", {
			outputKey: key,
			outputMime: "video/mp4",
			providerCost: (job.usage?.cost ?? 0).toFixed(6),
			completedAt: new Date(),
		});
	} catch (error) {
		await fail(claimed, userFacingError(error), error);
	}
}

/** For the webhook: the row waiting on this video job, if any. */
export async function advanceByExternalId(jobId: string): Promise<void> {
	const [row] = await getDb()
		.select()
		.from(marketingGeneration)
		.where(eq(marketingGeneration.pendingExternalId, jobId))
		.limit(1);
	if (!row) return;

	// The payload is only a hint; the API is the source of truth.
	await advance(row, await getVideoJob(jobId));
}

/** How long a video must have been rendering before a page visit checks on it. */
const PAGE_CHECK_AFTER_MS = 20 * 1000;

/**
 * Finishes any of this product's videos that are done at the provider. Run
 * from the product page's own polling, so someone watching sees the video
 * within seconds of it finishing instead of waiting for the webhook or the
 * 5-minute cron. Never throws: the page must load regardless.
 */
export async function refreshRendering(productId: string): Promise<void> {
	const rendering = await getDb()
		.select()
		.from(marketingGeneration)
		.where(
			and(
				eq(marketingGeneration.productId, productId),
				eq(marketingGeneration.status, "rendering"),
				lte(
					marketingGeneration.stepStartedAt,
					new Date(Date.now() - PAGE_CHECK_AFTER_MS),
				),
			),
		)
		.limit(5);

	await Promise.all(
		rendering.map(async (row) => {
			if (!row.pendingExternalId) return;
			try {
				await advance(row, await getVideoJob(row.pendingExternalId));
			} catch (error) {
				console.error(`promo ${row.id}: page check failed`, error);
			}
		}),
	);
}

/**
 * The safety net under the webhook: finishes videos whose webhook never came
 * (or cannot reach us, as in local dev), and gives up on stalled promos.
 */
export async function pollStaleGenerations(now = new Date()): Promise<void> {
	const waiting = await getDb()
		.select()
		.from(marketingGeneration)
		.where(
			and(
				inArray(marketingGeneration.status, ACTIVE),
				lte(
					marketingGeneration.stepStartedAt,
					new Date(now.getTime() - POLL_AFTER_MS),
				),
			),
		)
		.limit(50);

	for (const row of waiting) {
		const age = now.getTime() - row.stepStartedAt.getTime();
		try {
			if (row.status === "rendering" && row.pendingExternalId) {
				if (age > RENDER_TIMEOUT_MS) {
					await fail(
						row,
						"This promo took too long and was stopped. Your credits have been returned.",
					);
					continue;
				}
				await advance(row, await getVideoJob(row.pendingExternalId));
			} else if (age > LOCAL_STEP_TIMEOUT_MS) {
				// Our own step, abandoned when its request went away.
				await fail(
					row,
					"This promo was interrupted. Your credits have been returned.",
				);
			}
		} catch (error) {
			// One stuck row must not stop the rest.
			console.error(`promo ${row.id}: poll failed`, error);
		}
	}
}
