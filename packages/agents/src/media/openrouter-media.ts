/**
 * Image and video generation through OpenRouter — the same key and bill as
 * every text model, on its media endpoints rather than chat completions.
 *
 * Images are synchronous (`POST /images` answers with the picture). Videos
 * are jobs: submit, then poll or receive a signed webhook, then download
 * with the API key — the result URLs are not presigned.
 */

const API_ROOT = "https://openrouter.ai/api/v1";

/** Faithful to reference photos, so the product stays the product. */
export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image";

/** 4, 6 or 8 seconds, 16:9 or 9:16, first-frame input and native audio. */
export const DEFAULT_VIDEO_MODEL = "google/veo-3.1-fast";

export function resolveImageModel(): string {
	return process.env.OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

export function resolveVideoModel(): string {
	return process.env.OPENROUTER_VIDEO_MODEL?.trim() || DEFAULT_VIDEO_MODEL;
}

export class MediaGenerationError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "MediaGenerationError";
		this.status = status;
	}
}

function apiKey(): string {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) throw new Error("OPENROUTER_API_KEY is not set.");
	return key;
}

async function call<T>(
	method: "GET" | "POST",
	path: string,
	body?: unknown,
): Promise<T> {
	const response = await fetch(`${API_ROOT}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${apiKey()}`,
			"http-referer": "https://negarit.app",
			"x-title": "Negarit Branding",
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		let message = text.slice(0, 300) || response.statusText;
		try {
			const parsed = JSON.parse(text) as { error?: { message?: string } };
			if (parsed.error?.message) message = parsed.error.message;
		} catch {
			// Not JSON; keep the raw text.
		}
		throw new MediaGenerationError(
			`OpenRouter ${path} failed (${response.status}): ${message}`,
			response.status,
		);
	}
	return (await response.json()) as T;
}

/** Bytes as the data URL every image input accepts. */
export function toDataUrl(bytes: Uint8Array, mediaType: string): string {
	let binary = "";
	// Chunked: spreading a multi-megabyte array into one call overflows the stack.
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return `data:${mediaType};base64,${btoa(binary)}`;
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

type ImageInput = { type: "image_url"; image_url: { url: string } };

const asInput = (url: string): ImageInput => ({
	type: "image_url",
	image_url: { url },
});

export type GeneratedImage = {
	bytes: Uint8Array<ArrayBuffer>;
	mediaType: string;
	/** What OpenRouter charged, in USD. */
	usd: number;
	modelId: string;
};

/** One image from a prompt, guided by reference photos (as data URLs). */
export async function generateImage(input: {
	prompt: string;
	aspectRatio: string;
	references: readonly string[];
}): Promise<GeneratedImage> {
	const modelId = resolveImageModel();
	const result = await call<{
		data: { b64_json: string; media_type?: string }[];
		usage?: { cost?: number };
	}>("POST", "/images", {
		model: modelId,
		prompt: input.prompt,
		aspect_ratio: input.aspectRatio,
		input_references: input.references.map(asInput),
	});

	const image = result.data[0];
	if (!image) throw new MediaGenerationError("No image came back.", 502);

	return {
		bytes: fromBase64(image.b64_json),
		mediaType: image.media_type ?? "image/png",
		usd: result.usage?.cost ?? 0,
		modelId,
	};
}

export type VideoJob = {
	id: string;
	status:
		| "pending"
		| "in_progress"
		| "completed"
		| "failed"
		| "cancelled"
		| "expired";
	unsigned_urls?: string[];
	usage?: { cost?: number };
	error?: string | { message?: string };
};

/** Starts a clip that opens on `firstFrame` (a data URL). */
export async function createVideoJob(input: {
	prompt: string;
	durationSecs: number;
	aspectRatio: string;
	firstFrame: string;
	generateAudio: boolean;
	/** Signed completion webhook; omit to rely on polling. */
	callbackUrl?: string;
}): Promise<{ id: string; modelId: string }> {
	const modelId = resolveVideoModel();
	const job = await call<{ id: string }>("POST", "/videos", {
		model: modelId,
		prompt: input.prompt,
		duration: input.durationSecs,
		aspect_ratio: input.aspectRatio,
		resolution: "720p",
		generate_audio: input.generateAudio,
		frame_images: [{ ...asInput(input.firstFrame), frame_type: "first_frame" }],
		...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
	});
	return { id: job.id, modelId };
}

export function getVideoJob(id: string): Promise<VideoJob> {
	return call("GET", `/videos/${encodeURIComponent(id)}`);
}

/** The finished file. The URL needs the API key; it is not presigned. */
export async function downloadVideo(url: string): Promise<Response> {
	const response = await fetch(url, {
		headers: { authorization: `Bearer ${apiKey()}` },
	});
	if (!response.ok) {
		throw new MediaGenerationError(
			`Downloading the video failed: HTTP ${response.status}`,
			response.status,
		);
	}
	return response;
}

export function videoJobError(job: VideoJob): string {
	if (typeof job.error === "string") return job.error;
	return job.error?.message ?? `Video job ${job.status}.`;
}

/**
 * Verifies `X-OpenRouter-Signature: t=<unix seconds>,v1=<hex>`, where the
 * hex is HMAC-SHA256 over `<t>,<raw body>` keyed with the workspace's
 * webhook signing secret. Old deliveries are refused against replay.
 */
export async function verifyVideoWebhook(input: {
	rawBody: string;
	header: string | null;
	secret: string | undefined;
	toleranceSecs?: number;
	now?: Date;
}): Promise<boolean> {
	if (!input.header || !input.secret) return false;

	const parts = input.header.split(",").map((part) => part.trim());
	const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
	const signatures = parts
		.filter((p) => p.startsWith("v1="))
		.map((p) => p.slice(3));
	if (!timestamp || signatures.length === 0) return false;

	const sent = Number(timestamp);
	const nowSecs = Math.floor((input.now ?? new Date()).getTime() / 1000);
	if (
		!Number.isFinite(sent) ||
		Math.abs(nowSecs - sent) > (input.toleranceSecs ?? 30 * 60)
	) {
		return false;
	}

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(input.secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign(
			"HMAC",
			key,
			new TextEncoder().encode(`${timestamp},${input.rawBody}`),
		),
	);
	const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);

	return signatures.some((signature) => {
		if (signature.length !== expected.length) return false;
		let diff = 0;
		for (let i = 0; i < expected.length; i++) {
			diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
		}
		return diff === 0;
	});
}

/** The job id a webhook delivery is about; the caller re-reads the job. */
export function webhookJobId(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") return null;
	const body = payload as Record<string, unknown>;
	const data =
		body.data && typeof body.data === "object"
			? (body.data as Record<string, unknown>)
			: {};
	for (const candidate of [data.id, data.job_id, body.id, body.job_id]) {
		if (typeof candidate === "string" && candidate) return candidate;
	}
	return null;
}
