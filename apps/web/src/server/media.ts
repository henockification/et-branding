// The Workers runtime's own bindings, as in auth.ts.
import { env } from "cloudflare:workers";
import type { PhotoAdjustments } from "@et/agents";

/**
 * Photos: where they are kept and how they are polished.
 *
 * The only module that touches R2 or the Images binding, so the storage layout
 * and the transform rules live in one place.
 */

/** Longest edge kept. Past this a feed shows no difference, and Telegram caps photos at 10 MB. */
const MAX_EDGE = 2048;

/** What the vision model is shown. Detail beyond this costs tokens and changes no answer. */
const PREVIEW_EDGE = 1024;

const JPEG_QUALITY = 88;

type Jpeg = Uint8Array<ArrayBuffer>;

export function mediaKeys(
	orgId: string,
	mediaId: string,
): { original: string; polished: string } {
	const base = `orgs/${orgId}/media/${mediaId}`;
	return { original: `${base}/original.jpg`, polished: `${base}/polished.jpg` };
}

function toStream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
	return new Blob([bytes]).stream();
}

async function toJpeg(
	transformer: ImageTransformer,
	quality = JPEG_QUALITY,
): Promise<Jpeg> {
	const result = await transformer.output({ format: "image/jpeg", quality });
	return new Uint8Array(await new Response(result.image()).arrayBuffer());
}

/**
 * Re-encodes whatever arrived as a JPEG no bigger than `MAX_EDGE`.
 *
 * This is the "original" that is kept and offered back. It is resized but
 * otherwise untouched, so original and polished differ only by the polish —
 * and a PNG or an oversized file sent as a document becomes something Telegram
 * will accept as a photo.
 */
export async function normalise(
	bytes: Uint8Array<ArrayBuffer>,
): Promise<{ jpeg: Jpeg; width: number; height: number }> {
	const jpeg = await toJpeg(
		env.IMAGES.input(toStream(bytes)).transform({
			width: MAX_EDGE,
			height: MAX_EDGE,
			fit: "scale-down",
		}),
	);

	const info = await env.IMAGES.info(toStream(jpeg));
	if (!("width" in info)) {
		throw new Error("That file is not a photo I can read.");
	}

	return { jpeg, width: info.width, height: info.height };
}

/** The small copy the vision model looks at. */
export function preview(jpeg: Jpeg): Promise<Jpeg> {
	return toJpeg(
		env.IMAGES.input(toStream(jpeg)).transform({
			width: PREVIEW_EDGE,
			height: PREVIEW_EDGE,
			fit: "scale-down",
		}),
		80,
	);
}

/** Crop box for a target aspect, as large as the frame allows. */
function cropBox(
	width: number,
	height: number,
	crop: PhotoAdjustments["crop"],
): { width: number; height: number } | null {
	if (crop === "none") return null;

	// Width over height: 4:5 is the portrait shape feeds give the most room to.
	const aspect = crop === "4:5" ? 4 / 5 : 1;

	return width / height > aspect
		? { width: Math.round(height * aspect), height }
		: { width, height: Math.round(width / aspect) };
}

/**
 * Applies the light edit.
 *
 * Only Cloudflare's classic adjustments, never a generative model: every pixel
 * that comes out was in the photo that went in. The values arrive already
 * clamped by `readPhoto`; this just carries them out.
 *
 * Order matters: turn the photo upright first, so the crop is measured on the
 * frame the viewer will see, then adjust tone.
 */
export async function polish(options: {
	jpeg: Jpeg;
	width: number;
	height: number;
	adjustments: PhotoAdjustments;
	/** Crop around faces rather than whatever Cloudflare thinks is interesting. */
	favourFaces: boolean;
}): Promise<Jpeg> {
	const { adjustments } = options;
	let transformer = env.IMAGES.input(toStream(options.jpeg));

	if (adjustments.rotate !== 0) {
		transformer = transformer.transform({ rotate: adjustments.rotate });
	}

	const sideways = adjustments.rotate === 90 || adjustments.rotate === 270;
	const box = cropBox(
		sideways ? options.height : options.width,
		sideways ? options.width : options.height,
		adjustments.crop,
	);

	if (box) {
		transformer = transformer.transform({
			...box,
			fit: "cover",
			gravity: options.favourFaces ? "face" : "auto",
		});
	}

	transformer = transformer.transform({
		brightness: adjustments.brightness,
		contrast: adjustments.contrast,
		gamma: adjustments.gamma,
		saturation: adjustments.saturation,
		...(adjustments.sharpen > 0 ? { sharpen: adjustments.sharpen } : {}),
	});

	return toJpeg(transformer);
}

export async function putPhoto(key: string, jpeg: Jpeg): Promise<void> {
	await env.MEDIA.put(key, jpeg, {
		httpMetadata: { contentType: "image/jpeg" },
	});
}

/** The bytes of a stored photo, or null if it has gone. */
export async function getPhoto(key: string): Promise<Jpeg | null> {
	const object = await env.MEDIA.get(key);
	return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

/** A stored photo as an HTTP response, streamed rather than buffered. */
export async function photoResponse(key: string): Promise<Response | null> {
	const object = await env.MEDIA.get(key);
	if (!object) return null;

	return new Response(object.body, {
		headers: {
			"content-type": object.httpMetadata?.contentType ?? "image/jpeg",
			// Private: these sit behind a session check and must never land in a shared cache.
			"cache-control": "private, max-age=3600",
			etag: object.httpEtag,
		},
	});
}

/** Where Marketing Studio keeps product photos and finished promos. */
export const marketingKeys = {
	productPhoto: (orgId: string, productId: string, photoId: string) =>
		`orgs/${orgId}/marketing/products/${productId}/${photoId}.jpg`,
	output: (orgId: string, generationId: string, extension: string) =>
		`orgs/${orgId}/marketing/generations/${generationId}/output.${extension}`,
	voiceover: (orgId: string, generationId: string) =>
		`orgs/${orgId}/marketing/generations/${generationId}/voiceover.mp3`,
};

/**
 * Stores a provider's download in R2 without holding it all in memory when
 * its length is known — a promo video can run to tens of megabytes. R2 needs
 * the length up front to stream, so an unsized body is buffered instead.
 */
export async function putMedia(
	key: string,
	source: Response | Uint8Array<ArrayBuffer>,
	contentType: string,
): Promise<void> {
	if (source instanceof Uint8Array) {
		await env.MEDIA.put(key, source, { httpMetadata: { contentType } });
		return;
	}

	const length = Number(source.headers.get("content-length"));
	const httpMetadata = { contentType };

	if (source.body && Number.isSafeInteger(length) && length > 0) {
		const { readable, writable } = new FixedLengthStream(length);
		const piped = source.body.pipeTo(writable);
		await env.MEDIA.put(key, readable, { httpMetadata });
		await piped;
		return;
	}

	await env.MEDIA.put(key, await source.arrayBuffer(), { httpMetadata });
}

/** Removes stored objects, e.g. a deleted product's photos and promos. */
export async function deleteMedia(keys: string[]): Promise<void> {
	if (keys.length > 0) await env.MEDIA.delete(keys);
}

/**
 * A stored image or video as an HTTP response, honouring `Range`.
 *
 * Range is what makes video work: Safari will not play an mp4 from a server
 * that answers a byte-range request with the whole file, and every browser
 * needs it to seek.
 */
export async function mediaResponse(
	key: string,
	request: Request,
	options: { download?: string } = {},
): Promise<Response | null> {
	const rangeHeader = request.headers.get("range");
	const range = rangeHeader ? parseRange(rangeHeader) : undefined;

	const object = await env.MEDIA.get(key, range ? { range } : {});
	if (!object) return null;

	const headers = new Headers({
		"content-type":
			object.httpMetadata?.contentType ?? "application/octet-stream",
		"cache-control": "private, max-age=3600",
		"accept-ranges": "bytes",
		etag: object.httpEtag,
	});
	if (options.download) {
		headers.set(
			"content-disposition",
			`attachment; filename="${options.download.replace(/[^\w.-]+/g, "-")}"`,
		);
	}

	if (range && "range" in object && object.range) {
		const { offset = 0, length = object.size - offset } = object.range as {
			offset?: number;
			length?: number;
		};
		headers.set(
			"content-range",
			`bytes ${offset}-${offset + length - 1}/${object.size}`,
		);
		headers.set("content-length", String(length));
		return new Response(object.body, { status: 206, headers });
	}

	headers.set("content-length", String(object.size));
	return new Response(object.body, { headers });
}

/** `bytes=start-end`, `bytes=start-` or `bytes=-suffix`; anything else is ignored. */
function parseRange(header: string): R2Range | undefined {
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return undefined;
	const [, start, end] = match;
	if (start === "" && end === "") return undefined;
	if (start === "") return { suffix: Number(end) };
	if (end === "") return { offset: Number(start) };
	return { offset: Number(start), length: Number(end) - Number(start) + 1 };
}
