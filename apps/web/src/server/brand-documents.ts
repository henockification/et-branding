import { and, brandDocument, desc, eq, getDb, sql } from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readAccess, requireAccess } from "#/server/access";
import { fail } from "#/server/errors";
import {
	MAX_DOCUMENTS,
	MAX_LENGTH,
	MIN_LENGTH,
} from "#/server/telegram/capture";

/**
 * The past posts the Brand Brain writes like, managed from the web.
 *
 * Same store and the same limits as forwarding a post to the bot, so a post
 * added here and one forwarded there are indistinguishable to the agents.
 */

export const PAST_POST_MIN_LENGTH = MIN_LENGTH;

export const fetchPastPosts = createServerFn({ method: "GET" })
	.validator(z.object({ orgId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const access = await readAccess(data.orgId);
		if (!access) return { found: false } as const;

		const posts = await getDb()
			.select({
				id: brandDocument.id,
				content: brandDocument.content,
				source: brandDocument.source,
				createdAt: brandDocument.createdAt,
			})
			.from(brandDocument)
			.where(
				and(
					eq(brandDocument.orgId, data.orgId),
					eq(brandDocument.kind, "past_post"),
				),
			)
			.orderBy(desc(brandDocument.createdAt))
			.limit(MAX_DOCUMENTS);

		return {
			found: true as const,
			canEdit: access.canEdit,
			limit: MAX_DOCUMENTS,
			posts,
		};
	});

export const addPastPost = createServerFn({ method: "POST" })
	.validator(
		z.object({
			orgId: z.string().uuid(),
			content: z.string().trim().min(MIN_LENGTH).max(MAX_LENGTH),
		}),
	)
	.handler(async ({ data }) => {
		const access = await requireAccess(data.orgId, "edit");
		const db = getDb();

		// A duplicate would quietly double that post's pull on every draft.
		const [existing] = await db
			.select({ id: brandDocument.id })
			.from(brandDocument)
			.where(
				and(
					eq(brandDocument.orgId, data.orgId),
					eq(brandDocument.kind, "past_post"),
					eq(brandDocument.content, data.content),
				),
			)
			.limit(1);
		if (existing) {
			fail("That post is already in the brain.", 409);
		}

		const [{ count }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(brandDocument)
			.where(
				and(
					eq(brandDocument.orgId, data.orgId),
					eq(brandDocument.kind, "past_post"),
				),
			);
		if (count >= MAX_DOCUMENTS) {
			fail(
				`The brain already holds ${MAX_DOCUMENTS} posts. Remove some before adding more.`,
				409,
			);
		}

		await db.insert(brandDocument).values({
			orgId: data.orgId,
			kind: "past_post",
			title: data.content.split("\n")[0]?.slice(0, 120) || "Past post",
			source: "web",
			content: data.content,
			metadata: {
				addedBy: access.viewer.email,
				capturedAt: new Date().toISOString(),
			},
		});

		return { total: count + 1 };
	});

export const deletePastPost = createServerFn({ method: "POST" })
	.validator(z.object({ orgId: z.string().uuid(), postId: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireAccess(data.orgId, "edit");

		await getDb()
			.delete(brandDocument)
			.where(
				and(
					eq(brandDocument.id, data.postId),
					eq(brandDocument.orgId, data.orgId),
					eq(brandDocument.kind, "past_post"),
				),
			);

		return { deleted: true };
	});
