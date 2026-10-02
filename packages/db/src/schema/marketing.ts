import {
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { agentRun } from "./agents.ts";
import { user } from "./auth.ts";
import { organization } from "./organizations.ts";
import { baseColumns } from "./shared.ts";

/** One photo of a product, stored in R2 as a normalised JPEG. */
export type ProductPhoto = {
	id: string;
	key: string;
	width: number;
	height: number;
};

/**
 * Something a workspace sells, with the photos promos are made from. Photos
 * are the source of truth for what the product looks like: every generation
 * passes them to the model as references.
 */
export const marketingProduct = pgTable(
	"marketing_products",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		notes: text("notes"),
		photos: jsonb("photos").$type<ProductPhoto[]>().notNull().default([]),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [index("marketing_products_org_idx").on(t.orgId, t.createdAt)],
);

export const promoKind = pgEnum("promo_kind", [
	"image",
	"video",
	"video_voice",
]);

/**
 * Where a generation is. Only `rendering` a video waits on the provider, and
 * is resumed by its webhook or, failing that, the cron poll; every other
 * step runs straight through.
 */
export const promoStatus = pgEnum("promo_status", [
	"queued",
	"briefing",
	"voicing",
	"rendering",
	"storing",
	"completed",
	"failed",
]);

export type PromoSettings = {
	aspectRatio: string;
	/** Video only. */
	durationSecs?: number;
	/** Video + voice only; the ElevenLabs voice for the voiceover MP3. */
	voiceId?: string;
	/** Free text from the requester: mood, setting, offer to mention. */
	notes?: string;
	/** A voiceover the requester wrote or edited; skips the drafted one. */
	script?: string;
};

/** What the brief agent decided, kept so a re-run can start from it. */
export type PromoBrief = {
	productDescription: string;
	imagePrompt: string;
	videoPrompt: string;
	voiceoverScript: string;
};

/** The provider's ids for each step, so a webhook can find its row. */
export type PromoExternalIds = {
	/** OpenRouter video job. */
	video?: string;
	/** The job was given the ElevenLabs voiceover as its soundtrack. */
	withVoice?: boolean;
	/** A voiced render failed and this job is the narrated retry. */
	fallback?: boolean;
};

export const marketingGeneration = pgTable(
	"marketing_generations",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		productId: uuid("product_id")
			.notNull()
			.references(() => marketingProduct.id, { onDelete: "cascade" }),
		kind: promoKind("kind").notNull(),
		status: promoStatus("status").notNull().default("queued"),
		settings: jsonb("settings").$type<PromoSettings>().notNull(),
		brief: jsonb("brief").$type<PromoBrief>(),
		externalIds: jsonb("external_ids")
			.$type<PromoExternalIds>()
			.notNull()
			.default({}),
		/** The provider generation currently being waited on. */
		pendingExternalId: text("pending_external_id"),
		outputKey: text("output_key"),
		outputMime: text("output_mime"),
		/** Video + voice: the ElevenLabs voiceover as its own MP3. */
		voiceoverKey: text("voiceover_key"),
		/** Credits charged to the workspace. */
		credits: integer("credits").notNull(),
		/** What the provider charged, for the admin console only. */
		providerCost: numeric("provider_cost", { precision: 12, scale: 6 }),
		agentRunId: uuid("agent_run_id").references(() => agentRun.id, {
			onDelete: "set null",
		}),
		error: text("error"),
		/** When the current step started; the cron poll ages steps by it. */
		stepStartedAt: timestamp("step_started_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		index("marketing_generations_product_idx").on(t.productId, t.createdAt),
		index("marketing_generations_org_idx").on(t.orgId, t.createdAt),
		index("marketing_generations_pending_idx").on(t.pendingExternalId),
		index("marketing_generations_status_idx").on(t.status, t.stepStartedAt),
	],
);

export type MarketingProduct = typeof marketingProduct.$inferSelect;
export type MarketingGeneration = typeof marketingGeneration.$inferSelect;
export type PromoStatus = (typeof promoStatus.enumValues)[number];
