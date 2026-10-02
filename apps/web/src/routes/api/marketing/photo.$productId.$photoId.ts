import { eq, getDb, marketingProduct } from "@et/db";
import { createFileRoute } from "@tanstack/react-router";
import { mediaResponse } from "#/server/media";
import { readModuleAccess } from "#/server/modules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A product photo. Like `/api/media`, the only way into the private bucket,
 * and "missing" and "not yours" are the same 404.
 */
export const Route = createFileRoute(
	"/api/marketing/photo/$productId/$photoId",
)({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const notFound = () => new Response("Not Found", { status: 404 });
				if (!UUID.test(params.productId) || !UUID.test(params.photoId)) {
					return notFound();
				}

				const [product] = await getDb()
					.select({
						orgId: marketingProduct.orgId,
						photos: marketingProduct.photos,
					})
					.from(marketingProduct)
					.where(eq(marketingProduct.id, params.productId))
					.limit(1);

				if (
					!product ||
					!(await readModuleAccess(product.orgId, "marketing", request.headers))
				) {
					return notFound();
				}

				const photo = product.photos.find((p) => p.id === params.photoId);
				if (!photo) return notFound();

				return (await mediaResponse(photo.key, request)) ?? notFound();
			},
		},
	},
});
