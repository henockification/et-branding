/**
 * Amharic voiceovers, from Azure Speech.
 *
 * ElevenLabs and OpenRouter have no Amharic voice; Azure has two neural ones.
 * One REST call per voiceover: SSML in, MP3 out, no SDK.
 */

export const AZURE_AMHARIC_VOICES = [
	{ id: "am-ET-MekdesNeural", name: "Mekdes", description: "female" },
	{ id: "am-ET-AmehaNeural", name: "Ameha", description: "male" },
] as const;

export const DEFAULT_AMHARIC_VOICE = AZURE_AMHARIC_VOICES[0].id;

export function isAzureSpeechConfigured(): boolean {
	return Boolean(
		process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION,
	);
}

/** The voice to use: the requested one if it is ours, else the default. */
export function amharicVoice(requested: string | undefined): string {
	return AZURE_AMHARIC_VOICES.some((voice) => voice.id === requested)
		? (requested as string)
		: DEFAULT_AMHARIC_VOICE;
}

export class AzureSpeechError extends Error {
	readonly status: number;

	constructor(status: number, detail: string) {
		super(`Azure Speech failed (${status}): ${detail}`);
		this.name = "AzureSpeechError";
		this.status = status;
	}
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export function ssml(input: {
	voice: string;
	text: string;
	lang: string;
}): string {
	return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${input.lang}"><voice name="${escapeXml(input.voice)}">${escapeXml(input.text)}</voice></speak>`;
}

/** Speaks `text` and returns the MP3. */
export async function synthesizeAzure(input: {
	voice: string;
	text: string;
	lang?: string;
}): Promise<Uint8Array<ArrayBuffer>> {
	const key = process.env.AZURE_SPEECH_KEY;
	const region = process.env.AZURE_SPEECH_REGION;
	if (!key || !region) {
		throw new Error("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set.");
	}

	const response = await fetch(
		`https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
		{
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": key,
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
				"User-Agent": "negarit-branding",
			},
			body: ssml({
				voice: input.voice,
				text: input.text,
				lang: input.lang ?? "am-ET",
			}),
		},
	);

	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).slice(0, 300);
		throw new AzureSpeechError(response.status, detail || response.statusText);
	}
	const audio = new Uint8Array(await response.arrayBuffer());
	if (audio.length === 0) throw new AzureSpeechError(200, "Empty audio.");
	return audio;
}
