/**
 * Which languages the agents may write in.
 *
 * Amharic is deliberately off. It works — the models produce it — but two
 * things are unsettled: whether the quality is good enough to put a client's
 * name on, and that it costs roughly 6–8x an English post (Ge'ez script uses
 * about 3.6x the input tokens for the same prompt, and models ramble more).
 *
 * Turning it back on is a one-line change here: set `enabled: true`. Nothing
 * else needs to move — the database's `content_language` enum already accepts
 * "am", so there is no migration, and every surface reads this list rather
 * than hard-coding a language.
 */
export const LANGUAGES = {
	en: {
		code: "en",
		label: "English",
		/** How to name it to a model. */
		promptName: "English",
		enabled: true,
	},
	am: {
		code: "am",
		label: "አማርኛ",
		promptName: "Amharic",
		enabled: false,
		disabledReason:
			"Paused pending a quality review with the client, and a decision on the 6–8x cost per post.",
	},
} as const;

export type LanguageCode = keyof typeof LANGUAGES;
export type Language = (typeof LANGUAGES)[LanguageCode];

export function isLanguageCode(value: string): value is LanguageCode {
	return Object.hasOwn(LANGUAGES, value);
}

/** The languages agents may currently write in. Never empty. */
export function enabledLanguages(): readonly Language[] {
	const enabled = Object.values(LANGUAGES).filter((l) => l.enabled);

	if (enabled.length === 0) {
		throw new Error(
			"No languages are enabled — at least one entry in LANGUAGES must have enabled: true.",
		);
	}

	return enabled;
}

export function isLanguageEnabled(code: string): code is LanguageCode {
	return isLanguageCode(code) && LANGUAGES[code].enabled;
}

/** What to draft in when nobody has said otherwise. */
export function defaultLanguage(): Language {
	const [first] = enabledLanguages();
	// enabledLanguages() throws on empty, so this is always defined.
	return first as Language;
}
