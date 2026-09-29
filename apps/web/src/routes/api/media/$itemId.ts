import { contentItem, eq, getDb } from "@et/db";
import { createFileRoute } from "@tanstack/react-router";
import { readAccess } from "#/server/access";
import { photoResponse } from "#/server/media";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The photo attached to a draft, for the content queue.
 *
 * The bucket is private; this is the only way in. Membership is checked
 * against the draft's own workspace, and "no such draft" and "not yours" give
 * the same 404 so an id is never confirmed to exist.
 *
 * `?version=original|polished` picks a version; without it, whichever the
 * human chose.
 */
export const Route = createFileRoute("/api/media/$itemId")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const notFound = () => new Response("Not Found", { status: 404 });

				if (!UUID.test(params.itemId)) return notFound();

				const [item] = await getDb()
					.select({ orgId: contentItem.orgId, media: contentItem.media })
					.from(contentItem)
					.where(eq(contentItem.id, params.itemId))
					.limit(1);

				// Access is checked against the draft's own workspace.
				if (!item || !(await readAccess(item.orgId, request.headers))) {
					return notFound();
				}

				const photo = item.media?.find((media) => media.kind === "photo");
				if (!photo) return notFound();

				const requested = new URL(request.url).searchParams.get("version");
				const version =
					requested === "original" || requested === "polished"
						? requested
						: photo.selected;

				const response = await photoResponse(
					version === "original" ? photo.originalKey : photo.polishedKey,
				);

				return response ?? notFound();
			},
		},
	},
});
