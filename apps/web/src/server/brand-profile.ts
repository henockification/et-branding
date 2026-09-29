import {
	type BrandAudience,
	type BrandServices,
	type BrandVoice,
	brandProfileInputSchema,
} from "@et/core";
import { brandProfile, eq, getDb, organization } from "@et/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readAccess, requireAccess } from "#/server/access";

const orgIdSchema = z.object({ orgId: z.string().uuid() });

export const fetchBrandProfile = createServerFn({ method: "GET" })
	.validator(orgIdSchema)
	.handler(async ({ data }) => {
		const access = await readAccess(data.orgId);
		if (!access) return { found: false } as const;

		const [row] = await getDb()
			.select({
				orgName: organization.name,
				name: brandProfile.name,
				summary: brandProfile.summary,
				voice: brandProfile.voice,
				audience: brandProfile.audience,
				services: brandProfile.services,
			})
			.from(organization)
			.leftJoin(brandProfile, eq(brandProfile.orgId, organization.id))
			.where(eq(organization.id, data.orgId))
			.limit(1);

		if (!row) return { found: false } as const;

		return {
			found: true as const,
			role: access.role,
			canEdit: access.canEdit,
			orgName: row.orgName,
			name: row.name ?? row.orgName,
			summary: row.summary ?? "",
			voice: (row.voice ?? {}) as BrandVoice,
			audience: (row.audience ?? {}) as BrandAudience,
			services: (row.services ?? {}) as BrandServices,
		};
	});

export const saveBrandProfile = createServerFn({ method: "POST" })
	.validator(orgIdSchema.extend({ profile: brandProfileInputSchema }))
	.handler(async ({ data }) => {
		await requireAccess(data.orgId, "edit");

		const values = {
			name: data.profile.name,
			summary: data.profile.summary ?? null,
			voice: data.profile.voice ?? null,
			audience: data.profile.audience ?? null,
			services: data.profile.services ?? null,
			updatedAt: new Date(),
		};

		// Upsert rather than update: an organization created before profiles
		// existed, or by a path that skipped one, should still be editable.
		await getDb()
			.insert(brandProfile)
			.values({ orgId: data.orgId, ...values })
			.onConflictDoUpdate({ target: brandProfile.orgId, set: values });

		return { saved: true };
	});
