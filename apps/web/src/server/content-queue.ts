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
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAuth } from "#/server/auth";

const STATUSES = ["draft", "approved", "rejected", "published"] as const;
const ORIGINS = ["ad_hoc", "weekly_plan"] as const;
export type ContentStatus = (typeof STATUSES)[number];
export type ContentOrigin = (typeof ORIGINS)[number];

/** One page of history. Long enough to judge a trend, short enough to load. */
const PAGE_SIZE = 50;

/**
 * Whether the caller may read this workspace.
 *
 * Returns rather than throws. A thrown `Response` works for a mutation, but a
 * page loader that throws one escapes as an unhandled 500 and the visitor sees
 * raw JSON instead of the app — so loaders return a result the route can turn
 * into a proper not-found.
 *
 * "Not a member" and "no such workspace" are the same answer, so a response
 * never confirms an id is real.
 */
async function canRead(orgId: string): Promise<boolean> {
	const session = await getAuth().api.getSession({
		headers: getRequest().headers,
	});

	if (!session) return false;

	const [membership] = await getDb()
		.select({ role: orgMember.role })
		.from(orgMember)
		.where(
			and(eq(orgMember.orgId, orgId), eq(orgMember.userId, session.user.id)),
		)
		.limit(1);

	return Boolean(membership);
}

export const fetchContentQueue = createServerFn({ method: "GET" })
	.validator(
		z.object({
			orgId: z.string().uuid(),
			status: z.enum(STATUSES).optional(),
			origin: z.enum(ORIGINS).optional(),
		}),
	)
	.handler(async ({ data }) => {
		if (!(await canRead(data.orgId))) {
			return { found: false } as const;
		}

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
