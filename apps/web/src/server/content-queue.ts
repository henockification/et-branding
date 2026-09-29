import {
	and,
	brandDocument,
	contentItem,
	desc,
	eq,
	getDb,
	organization,
	orgMember,
	sql,
} from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readAccess, requireAccess } from "#/server/access";

const STATUSES = ["draft", "approved", "rejected", "published"] as const;
const ORIGINS = ["ad_hoc", "weekly_plan"] as const;
export type ContentStatus = (typeof STATUSES)[number];
export type ContentOrigin = (typeof ORIGINS)[number];

/** One page of history. Long enough to judge a trend, short enough to load. */
const PAGE_SIZE = 50;

export const fetchContentQueue = createServerFn({ method: "GET" })
	.validator(
		z.object({
			orgId: z.string().uuid(),
			status: z.enum(STATUSES).optional(),
			origin: z.enum(ORIGINS).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const access = await readAccess(data.orgId);
		if (!access) return { found: false } as const;

		const db = getDb();

		const [org] = await db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, data.orgId))
			.limit(1);

		if (!org) return { found: false } as const;

		const items = await db
			.select({
				id: contentItem.id,
				body: contentItem.body,
				media: contentItem.media,
				origin: contentItem.origin,
				plannedFor: contentItem.plannedFor,
				angle: contentItem.angle,
				originalBody: contentItem.originalBody,
				status: contentItem.status,
				channel: contentItem.channel,
				language: contentItem.language,
				feedback: contentItem.feedback,
				createdAt: contentItem.createdAt,
				reviewedAt: contentItem.reviewedAt,
				reviewedBy: orgMember.displayName,
			})
			.from(contentItem)
			.leftJoin(orgMember, eq(orgMember.id, contentItem.reviewedBy))
			.where(
				and(
					eq(contentItem.orgId, data.orgId),
					...(data.status ? [eq(contentItem.status, data.status)] : []),
					...(data.origin ? [eq(contentItem.origin, data.origin)] : []),
				),
			)
			.orderBy(desc(contentItem.createdAt))
			.limit(PAGE_SIZE);

		const counts = await db
			.select({
				status: contentItem.status,
				count: sql<number>`count(*)::int`,
			})
			.from(contentItem)
			.where(eq(contentItem.orgId, data.orgId))
			.groupBy(contentItem.status);

		const originCounts = await db
			.select({
				origin: contentItem.origin,
				count: sql<number>`count(*)::int`,
			})
			.from(contentItem)
			.where(eq(contentItem.orgId, data.orgId))
			.groupBy(contentItem.origin);

		/**
		 * What the next draft will actually learn from.
		 *
		 * Shown because the caps are not obvious from the list: an explained
		 * rejection teaches, an unexplained one does not, and seeing the four
		 * numbers is the quickest way to understand why drafts are or are not
		 * improving.
		 */
		const [learning] = await db
			.select({
				pastPosts: sql<number>`(select count(*)::int from ${brandDocument} where ${brandDocument.orgId} = ${data.orgId} and ${brandDocument.kind} = 'past_post')`,
				approved: sql<number>`(select count(*)::int from ${contentItem} where ${contentItem.orgId} = ${data.orgId} and ${contentItem.status} = 'approved' and ${contentItem.originalBody} is null)`,
				corrections: sql<number>`(select count(*)::int from ${contentItem} where ${contentItem.orgId} = ${data.orgId} and ${contentItem.originalBody} is not null)`,
				explainedRejections: sql<number>`(select count(*)::int from ${contentItem} where ${contentItem.orgId} = ${data.orgId} and ${contentItem.status} = 'rejected' and ${contentItem.feedback} is not null)`,
				silentRejections: sql<number>`(select count(*)::int from ${contentItem} where ${contentItem.orgId} = ${data.orgId} and ${contentItem.status} = 'rejected' and ${contentItem.feedback} is null)`,
			})
			.from(sql`(select 1) as one`);

		return {
			found: true as const,
			orgName: org.name,
			canEdit: access.canEdit,
			items,
			counts: Object.fromEntries(
				counts.map((c) => [c.status, c.count]),
			) as Partial<Record<ContentStatus, number>>,
			originCounts: Object.fromEntries(
				originCounts.map((c) => [c.origin, c.count]),
			) as Partial<Record<ContentOrigin, number>>,
			learning: learning ?? {
				pastPosts: 0,
				approved: 0,
				corrections: 0,
				explainedRejections: 0,
				silentRejections: 0,
			},
		};
	});

/** Same bounds as a correction sent from Telegram. */
const MIN_EDIT_LENGTH = 10;
const MAX_EDIT_LENGTH = 3000;

const itemSchema = z.object({
	orgId: z.string().uuid(),
	itemId: z.string().uuid(),
});

/**
 * Approve or reject a draft from the web.
 *
 * Writes exactly what the Telegram buttons write — status, who, when, and an
 * optional reason — because these rows are what the agents learn from, and a
 * decision made on the web must teach the same lesson as one made in the chat.
 *
 * Only an undecided draft can be decided, so a web click and a Telegram tap
 * landing together cannot both win.
 */
export const decideDraft = createServerFn({ method: "POST" })
	.validator(
		itemSchema.extend({
			decision: z.enum(["approved", "rejected"]),
			reason: z.string().trim().max(1000).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const access = await requireAccess(data.orgId, "edit");

		const [decided] = await getDb()
			.update(contentItem)
			.set({
				status: data.decision,
				reviewedBy: access.memberId,
				reviewedAt: new Date(),
				// A reason is only kept for a rejection, where it teaches something.
				...(data.decision === "rejected" && data.reason
					? { feedback: data.reason }
					: {}),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(contentItem.id, data.itemId),
					eq(contentItem.orgId, data.orgId),
					eq(contentItem.status, "draft"),
				),
			)
			.returning({ id: contentItem.id });

		if (!decided) {
			throw new Response("That draft was already decided.", { status: 409 });
		}

		return { status: data.decision };
	});

/**
 * Save a human's version of a draft, approving it in the same act.
 *
 * Keeps the agent's first attempt in `originalBody`: the pair — what the agent
 * wrote and what a person changed it to — is the strongest signal the agents
 * get, exactly as with an edit sent from Telegram.
 */
export const editDraft = createServerFn({ method: "POST" })
	.validator(
		itemSchema.extend({
			body: z.string().trim().min(MIN_EDIT_LENGTH).max(MAX_EDIT_LENGTH),
		}),
	)
	.handler(async ({ data }) => {
		const access = await requireAccess(data.orgId, "edit");
		const db = getDb();

		const [item] = await db
			.select({
				body: contentItem.body,
				originalBody: contentItem.originalBody,
				status: contentItem.status,
			})
			.from(contentItem)
			.where(
				and(eq(contentItem.id, data.itemId), eq(contentItem.orgId, data.orgId)),
			)
			.limit(1);

		if (!item) throw new Response("Not found.", { status: 404 });

		if (item.status === "published") {
			throw new Response("That post is already out.", { status: 409 });
		}

		if (item.body.trim() === data.body) return { status: item.status };

		await db
			.update(contentItem)
			.set({
				body: data.body,
				status: "approved",
				originalBody: item.originalBody ?? item.body,
				reviewedBy: access.memberId,
				reviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(contentItem.id, data.itemId));

		return { status: "approved" as const };
	});
