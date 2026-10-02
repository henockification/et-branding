import { getDb, marketingProduct, type ProductPhoto } from "@et/db";
import { createFileRoute } from "@tanstack/react-router";
import { marketingKeys, normalise, putPhoto } from "#/server/media";
import { readModuleAccess } from "#/server/modules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enough angles to show a product; more only slows every generation down. */
const MAX_PHOTOS = 6;

/** As for photos sent to the bot. */
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Creates a product from its name and photos (multipart).
 *
 * A route rather than a server function because the body is files. Every
 * photo is re-encoded to a JPEG of at most 2048px before it is kept, so what
 * the models see is predictable whatever the phone sent.
 */
export const Route = createFileRoute("/api/marketing/products")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				let form: FormData;
				try {
					form = await request.formData();
				} catch {
					return json({ error: "Send the product as a form." }, 400);
				}

				const orgId = String(form.get("orgId") ?? "");
				const name = String(form.get("name") ?? "").trim();
				const notes = String(form.get("notes") ?? "").trim();
				const files = form
					.getAll("photos")
					.filter((value): value is File => value instanceof File);

				if (!UUID.test(orgId)) return json({ error: "Not found." }, 404);

				const allowed = await readModuleAccess(
					orgId,
					"marketing",
					request.headers,
				);
				if (!allowed) return json({ error: "Not found." }, 404);
				if (!allowed.access.canEdit) {
					return json(
						{ error: "Only an owner or approver can add products." },
						403,
					);
				}

				if (!name || name.length > 120) {
					return json(
						{ error: "Give the product a name (up to 120 characters)." },
						400,
					);
				}
				if (notes.length > 1000) {
					return json({ error: "Keep the notes under 1,000 characters." }, 400);
				}
				if (files.length === 0 || files.length > MAX_PHOTOS) {
					return json(
						{ error: `Add between 1 and ${MAX_PHOTOS} photos.` },
						400,
					);
				}
				const tooBig = files.find((file) => file.size > MAX_PHOTO_BYTES);
				if (tooBig) {
					return json({ error: `${tooBig.name} is over 20 MB.` }, 400);
				}

				const productId = crypto.randomUUID();
				const photos: ProductPhoto[] = [];
				for (const file of files) {
					try {
						const photoId = crypto.randomUUID();
						const { jpeg, width, height } = await normalise(
							new Uint8Array(await file.arrayBuffer()),
						);
						const key = marketingKeys.productPhoto(orgId, productId, photoId);
						await putPhoto(key, jpeg);
						photos.push({ id: photoId, key, width, height });
					} catch {
						return json(
							{ error: `${file.name} is not a photo I can read.` },
							400,
						);
					}
				}

				await getDb()
					.insert(marketingProduct)
					.values({
						id: productId,
						orgId,
						name,
						notes: notes || null,
						photos,
						createdBy: allowed.access.viewer.userId,
					});

				return json({ productId });
			},
			GET: async () => new Response("Method Not Allowed", { status: 405 }),
		},
	},
});
