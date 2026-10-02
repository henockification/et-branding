import { eq, getDb, marketingGeneration, marketingProduct } from "@et/db";
import { createFileRoute } from "@tanstack/react-router";
import { mediaResponse } from "#/server/media";
import { readModuleAccess } from "#/server/modules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A finished promo, image or video; with `?file=voiceover` its voiceover
 * MP3, with `?file=hero` the frame a video opens on. `?download=1` serves it as an attachment named after the product.
 * Byte ranges are honoured so video and audio play and seek.
 */
export const Route = createFileRoute("/api/marketing/output/$generationId")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const notFound = () => new Response("Not Found", { status: 404 });
				if (!UUID.test(params.generationId)) return notFound();

				const [row] = await getDb()
					.select({
						orgId: marketingGeneration.orgId,
						key: marketingGeneration.outputKey,
						voiceoverKey: marketingGeneration.voiceoverKey,
						externalIds: marketingGeneration.externalIds,
						kind: marketingGeneration.kind,
						product: marketingProduct.name,
					})
					.from(marketingGeneration)
					.innerJoin(
						marketingProduct,
						eq(marketingProduct.id, marketingGeneration.productId),
					)
					.where(eq(marketingGeneration.id, params.generationId))
					.limit(1);

				if (
					!row ||
					!(await readModuleAccess(row.orgId, "marketing", request.headers))
				) {
					return notFound();
				}

				const search = new URL(request.url).searchParams;
				// `?file=voiceover`: the voiceover MP3 of a video + voice promo.
				// `?file=hero`: the generated frame a video opens on.
				const file = search.get("file");
				const key =
					file === "voiceover"
						? row.voiceoverKey
						: file === "hero"
							? (row.externalIds.heroKey ?? null)
							: row.key;
				if (!key) return notFound();

				const extension = key.slice(key.lastIndexOf(".") + 1);
				const label = file === "voiceover" || file === "hero" ? file : row.kind;

				return (
					(await mediaResponse(key, request, {
						download:
							search.get("download") === "1"
								? `${row.product}-${label}.${extension}`
								: undefined,
					})) ?? notFound()
				);
			},
		},
	},
});
