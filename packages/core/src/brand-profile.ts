import { z } from "zod";

/**
 * The structured half of the Brand Brain.
 *
 * These shapes are the contract between the form people fill in and the prompt
 * the agent is given, which is why they live in `@et/core` rather than in
 * either side. They are stored as JSON columns, so adding a field here needs no
 * migration — but the agent only uses what it is handed, so a new field also
 * needs a line in the prompt builder to have any effect.
 *
 * Everything is optional. A half-filled profile is more useful to an agent than
 * an empty one, so nothing blocks saving.
 */

const line = z.string().trim().max(400);

/** Text areas are filled one item per line; blank lines are dropped. */
export function linesToList(text: string): string[] {
	return text
		.split("\n")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.slice(0, 50);
}

export function listToLines(list: readonly string[] | undefined): string {
	return (list ?? []).join("\n");
}

export const voiceSchema = z.object({
	/** How the brand sounds, in a sentence or two. */
	tone: z.string().trim().max(2000).optional(),
	/** Things to do — "short sentences", "lead with the outcome". */
	dos: z.array(line).max(50).optional(),
	/** Things never to do — "no jargon", "never say 'AI-powered'". */
	donts: z.array(line).max(50).optional(),
});

export const audienceSchema = z.object({
	/** Who the brand is mainly for. */
	primary: z.string().trim().max(2000).optional(),
	/** Distinct groups worth addressing differently. */
	segments: z.array(line).max(50).optional(),
});

export const servicesSchema = z.object({
	/** What the business actually sells. */
	items: z.array(line).max(50).optional(),
});

export const brandProfileInputSchema = z.object({
	name: z.string().trim().min(1).max(120),
	summary: z.string().trim().max(4000).optional(),
	voice: voiceSchema.optional(),
	audience: audienceSchema.optional(),
	services: servicesSchema.optional(),
});

export type BrandVoice = z.infer<typeof voiceSchema>;
export type BrandAudience = z.infer<typeof audienceSchema>;
export type BrandServices = z.infer<typeof servicesSchema>;
export type BrandProfileInput = z.infer<typeof brandProfileInputSchema>;

/**
 * How complete the profile is, as a fraction.
 *
 * Shown to whoever is filling it in, because the difference between an empty
 * profile and a full one is the difference between generic copy and the
 * brand's own voice — and that is not obvious from an empty form.
 */
export function profileCompleteness(profile: {
	summary?: string | null;
	voice?: BrandVoice | null;
	audience?: BrandAudience | null;
	services?: BrandServices | null;
}): { filled: number; total: number } {
	const checks = [
		Boolean(profile.summary?.trim()),
		Boolean(profile.voice?.tone?.trim()),
		(profile.voice?.dos?.length ?? 0) > 0 ||
			(profile.voice?.donts?.length ?? 0) > 0,
		Boolean(profile.audience?.primary?.trim()),
		(profile.services?.items?.length ?? 0) > 0,
	];

	return { filled: checks.filter(Boolean).length, total: checks.length };
}
