import type { BrandContext } from "@et/agents";
import {
	and,
	brandDocument,
	brandProfile,
	contentItem,
	desc,
	eq,
	getDb,
	isNotNull,
	isNull,
} from "@et/db";
import { callbackData, formatRef, type ReplyMarkup } from "@et/telegram";

/**
 * How much of the brand's own history is replayed into each draft.
 *
 * Corrections are capped tightest because they are the strongest signal — a
 * long list of old mistakes would drown out the voice itself — and approved
 * posts are capped below past posts because they are the agent's own output
 * and risk the model reinforcing its own habits.
 */
const MAX_EXAMPLES = 50;
const MAX_APPROVED = 20;
const MAX_CORRECTIONS = 10;
const MAX_REJECTIONS = 10;

export type LoadedBrand = {
	brand: BrandContext;
	counts: {
		pastPosts: number;
		approved: number;
		corrections: number;
		rejections: number;
	};
};

/**
 * Everything an agent is told about a brand before it writes.
 *
 * Shared by drafting and refinement: a refinement that saw less history than
 * the draft it is rewriting would quietly undo the brand's voice.
 */
export async function loadBrandContext(
	orgId: string,
): Promise<LoadedBrand | null> {
	const db = getDb();

	const [profile] = await db
		.select({
			name: brandProfile.name,
			summary: brandProfile.summary,
			voice: brandProfile.voice,
			audience: brandProfile.audience,
			services: brandProfile.services,
		})
		.from(brandProfile)
		.where(eq(brandProfile.orgId, orgId))
		.limit(1);

	if (!profile) return null;

	const [examples, approved, corrections, rejections] = await Promise.all([
		db
			.select({ content: brandDocument.content })
			.from(brandDocument)
			.where(
				and(
					eq(brandDocument.orgId, orgId),
					eq(brandDocument.kind, "past_post"),
				),
			)
			.orderBy(desc(brandDocument.createdAt))
			.limit(MAX_EXAMPLES),

		// Approved untouched: the agent got these right on its own.
		db
			.select({ body: contentItem.body })
			.from(contentItem)
			.where(
				and(
					eq(contentItem.orgId, orgId),
					eq(contentItem.status, "approved"),
					isNull(contentItem.originalBody),
				),
			)
			.orderBy(desc(contentItem.reviewedAt))
			.limit(MAX_APPROVED),

		db
			.select({ before: contentItem.originalBody, after: contentItem.body })
			.from(contentItem)
			.where(
				and(eq(contentItem.orgId, orgId), isNotNull(contentItem.originalBody)),
			)
			.orderBy(desc(contentItem.reviewedAt))
			.limit(MAX_CORRECTIONS),

		// Only rejections someone explained. A bare "no" says something was wrong
		// without saying what.
		db
			.select({ body: contentItem.body, reason: contentItem.feedback })
			.from(contentItem)
			.where(
				and(
					eq(contentItem.orgId, orgId),
					eq(contentItem.status, "rejected"),
					isNotNull(contentItem.feedback),
				),
			)
			.orderBy(desc(contentItem.reviewedAt))
			.limit(MAX_REJECTIONS),
	]);

	return {
		brand: {
			...(profile as BrandContext),
			examples: [
				...examples.map((e) => e.content),
				...approved.map((a) => a.body),
			],
			corrections: corrections.flatMap((c) =>
				c.before ? [{ before: c.before, after: c.after }] : [],
			),
			rejections: rejections.flatMap((r) =>
				r.reason ? [{ body: r.body, reason: r.reason }] : [],
			),
		},
		counts: {
			pastPosts: examples.length,
			approved: approved.length,
			corrections: corrections.length,
			rejections: rejections.length,
		},
	};
}

/**
 * The buttons under a draft.
 *
 * One definition, because `draft.ts` and `weekly.ts` both send drafts and a
 * second row added to only one of them is the easiest bug to ship here.
 *
 * Row one decides, row two asks for another attempt.
 */
export function draftKeyboard(itemId: string): ReplyMarkup {
	return {
		inline_keyboard: [
			[
				{ text: "✅ Approve", callback_data: callbackData("approve", itemId) },
				{ text: "✏️ Edit", callback_data: callbackData("edit", itemId) },
				{ text: "🗑 Reject", callback_data: callbackData("reject", itemId) },
			],
			[
				{ text: "🔁 Try again", callback_data: callbackData("again", itemId) },
				{ text: "✂️ Shorter", callback_data: callbackData("shorter", itemId) },
				{ text: "📣 Add a CTA", callback_data: callbackData("cta", itemId) },
			],
		],
	};
}

/** The footer that makes a delivered draft replyable. */
export function draftFooter(itemId: string, note: string): string {
	return `<i>${note}</i>\n${formatRef(itemId, "draft")}`;
}
