import { ElevenLabsClient, type Voice } from "@et/elevenlabs";

/**
 * Who makes what: OpenRouter renders images and video (the same key as every
 * text model), ElevenLabs records voiceovers. ElevenLabs is optional — without
 * it, "Video + voice" still gets the video's own narration, just no MP3.
 */

export function isMediaProviderConfigured(): boolean {
	return Boolean(process.env.OPENROUTER_API_KEY);
}

export function isVoiceConfigured(): boolean {
	return Boolean(process.env.ELEVENLABS_API_KEY);
}

let cached: ElevenLabsClient | undefined;

/** Built once per isolate; throws with the variable name if unconfigured. */
export function getElevenLabs(): ElevenLabsClient {
	if (!cached) {
		const key = process.env.ELEVENLABS_API_KEY;
		if (!key) {
			throw new Error(
				"ELEVENLABS_API_KEY is not set — see apps/web/.dev.vars.example.",
			);
		}
		cached = new ElevenLabsClient(key);
	}
	return cached;
}

let voices: { at: number; list: Voice[] } | undefined;
const VOICES_TTL_MS = 60 * 60 * 1000;

/** The account's voices, cached per isolate: they change when someone adds one. */
export async function listVoices(): Promise<Voice[]> {
	if (!voices || Date.now() - voices.at > VOICES_TTL_MS) {
		voices = { at: Date.now(), list: await getElevenLabs().listVoices() };
	}
	return voices.list;
}

export function defaultVoiceId(): string | undefined {
	return process.env.ELEVENLABS_DEFAULT_VOICE_ID || undefined;
}

/**
 * Where OpenRouter should report a finished video, or undefined to rely on
 * the cron poll — when no signing secret is set, or the app is not on a
 * public https URL (local dev).
 */
export function videoCallbackUrl(): string | undefined {
	const base = process.env.BETTER_AUTH_URL;
	if (!process.env.OPENROUTER_WEBHOOK_SECRET || !base?.startsWith("https://")) {
		return undefined;
	}
	return new URL("/api/marketing/openrouter-webhook", base).toString();
}
