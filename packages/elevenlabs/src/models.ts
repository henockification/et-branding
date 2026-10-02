/** Speaks English and Amharic among ~30 others. Override with ELEVENLABS_SPEECH_MODEL. */
export const DEFAULT_SPEECH_MODEL = "eleven_multilingual_v2";

export function resolveSpeechModel(
	env: Record<string, string | undefined> = process.env,
): string {
	return env.ELEVENLABS_SPEECH_MODEL?.trim() || DEFAULT_SPEECH_MODEL;
}
