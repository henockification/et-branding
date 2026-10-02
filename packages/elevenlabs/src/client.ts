const API_ROOT = "https://api.elevenlabs.io";

export class ElevenLabsError extends Error {
	readonly path: string;
	readonly status: number;
	readonly detail: string;

	constructor(path: string, status: number, detail: string) {
		super(`ElevenLabs ${path} failed (${status}): ${detail}`);
		this.name = "ElevenLabsError";
		this.path = path;
		this.status = status;
		this.detail = detail;
	}
}

export type Voice = {
	voice_id: string;
	name: string;
	category?: string;
	labels?: Record<string, string>;
	preview_url?: string;
};

/**
 * A thin typed wrapper over the parts of the ElevenLabs API we use: the
 * account's voices and plain text-to-speech.
 *
 * Plain `fetch`, no SDK, so it runs unchanged on Workers. The Flows API
 * (image, video, async speech) needs the Pro plan and is not used.
 */
export class ElevenLabsClient {
	private readonly apiKey: string;

	constructor(apiKey: string | undefined) {
		if (!apiKey) {
			throw new Error("ELEVENLABS_API_KEY is not set.");
		}
		this.apiKey = apiKey;
	}

	private async request(
		method: "GET" | "POST",
		path: string,
		body?: unknown,
	): Promise<Response> {
		const response = await fetch(`${API_ROOT}${path}`, {
			method,
			headers: {
				"xi-api-key": this.apiKey,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		if (!response.ok) {
			throw new ElevenLabsError(
				path,
				response.status,
				await readDetail(response),
			);
		}
		return response;
	}

	/**
	 * Speaks `text` in `voiceId` and returns the MP3. Synchronous: a promo
	 * voiceover is a few sentences, which takes seconds.
	 */
	async textToSpeech(input: {
		voiceId: string;
		text: string;
		modelId: string;
		languageCode?: string;
	}): Promise<Uint8Array<ArrayBuffer>> {
		const response = await this.request(
			"POST",
			`/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`,
			{
				text: input.text,
				model_id: input.modelId,
				...(input.languageCode ? { language_code: input.languageCode } : {}),
			},
		);
		return new Uint8Array(await response.arrayBuffer());
	}

	async listVoices(): Promise<Voice[]> {
		const response = await this.request("GET", "/v1/voices");
		return ((await response.json()) as { voices: Voice[] }).voices;
	}
}

/** The most useful line of an error body, whatever shape it came in. */
async function readDetail(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	try {
		const parsed = JSON.parse(text) as {
			detail?: string | { message?: string } | { msg?: string }[];
		};
		const detail = parsed.detail;
		if (typeof detail === "string") return detail;
		if (Array.isArray(detail)) return detail.map((d) => d.msg).join("; ");
		if (detail?.message) return detail.message;
	} catch {
		// Not JSON; fall through to the raw text.
	}
	return text.slice(0, 300) || response.statusText;
}
