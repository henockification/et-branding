import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	uniqueIndex,
	uuid,
	vector,
} from "drizzle-orm/pg-core";
import { organization } from "./organizations.ts";
import { baseColumns } from "./shared.ts";

/**
 * OpenAI `text-embedding-3-small`. Changing model means changing this number
 * and re-embedding everything — the column width is part of the contract.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * The structured half of the Brand Brain: what the agents are told about the
 * brand before they are told anything else.
 *
 * Voice, audience and services are JSON rather than columns because their shape
 * is still moving and every agent reads them whole. Colours and fonts come from
 * the design system.
 */
export const brandProfile = pgTable(
	"brand_profiles",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** One paragraph an agent can lead with. */
		summary: text("summary"),
		/** `{ tone, dos, donts, examples }` — how the brand sounds. */
		voice: jsonb("voice").$type<Record<string, unknown>>(),
		/** `{ primary, secondary, segments }` — who it is for. */
		audience: jsonb("audience").$type<Record<string, unknown>>(),
		/** What the business actually sells. */
		services: jsonb("services").$type<Record<string, unknown>>(),
		/** `{ colors, fonts, logoUrls }`, mirroring the design system. */
		visualIdentity: jsonb("visual_identity").$type<Record<string, unknown>>(),
	},
	(table) => [
		// One profile per org for now; the unique index makes that explicit
		// rather than leaving duplicates possible.
		uniqueIndex("brand_profiles_org_id_key").on(table.orgId),
	],
);

export const documentKind = pgEnum("document_kind", [
	"guideline",
	"past_post",
	"press_release",
	"transcript",
	"other",
]);

/**
 * The unstructured half of the Brain: past posts, guidelines, press releases.
 *
 * The client's 30–50 best past posts land here — this corpus is what makes the
 * voice sound like them rather than like a model.
 */
export const brandDocument = pgTable(
	"brand_documents",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		kind: documentKind("kind").notNull().default("other"),
		title: text("title").notNull(),
		/** Where it came from: a URL, a filename, "telegram upload". */
		source: text("source"),
		content: text("content").notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	},
	(table) => [index("brand_documents_org_id_idx").on(table.orgId)],
);

/**
 * Embedded slices of a document.
 *
 * Chunks rather than whole documents: a press release is far longer than the
 * span that actually answers a retrieval query, and embedding the whole thing
 * blurs it. `orgId` is denormalised here so a similarity search can filter by
 * tenant without joining back to the document.
 */
export const brandDocumentChunk = pgTable(
	"brand_document_chunks",
	{
		...baseColumns,
		orgId: uuid("org_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		documentId: uuid("document_id")
			.notNull()
			.references(() => brandDocument.id, { onDelete: "cascade" }),
		chunkIndex: integer("chunk_index").notNull(),
		content: text("content").notNull(),
		embedding: vector("embedding", {
			dimensions: EMBEDDING_DIMENSIONS,
		}).notNull(),
	},
	(table) => [
		index("brand_document_chunks_org_id_idx").on(table.orgId),
		index("brand_document_chunks_document_id_idx").on(table.documentId),
		// HNSW with cosine distance: OpenAI embeddings are normalised, and HNSW
		// can be built before the table has enough rows for ivfflat to train.
		index("brand_document_chunks_embedding_idx").using(
			"hnsw",
			table.embedding.op("vector_cosine_ops"),
		),
	],
);

export type BrandProfile = typeof brandProfile.$inferSelect;
export type BrandDocument = typeof brandDocument.$inferSelect;
export type BrandDocumentChunk = typeof brandDocumentChunk.$inferSelect;
