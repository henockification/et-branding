import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { ImagePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CreditsBadge } from "#/components/credits-badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { fetchMarketingHome } from "#/server/marketing/studio";

/** Mirrors the upload route's limits, so the form refuses before uploading. */
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export const Route = createFileRoute("/_authed/marketing/$orgId/")({
	loader: async ({ params }) => {
		const result = await fetchMarketingHome({ data: { orgId: params.orgId } });
		// Not a member, or no Marketing Studio: the same not-found either way.
		if (!result.found) throw notFound();
		return result;
	},
	component: MarketingHome,
});

function MarketingHome() {
	const { orgId } = Route.useParams();
	const home = useQuery({
		queryKey: ["marketing-home", orgId],
		queryFn: async () => {
			const result = await fetchMarketingHome({ data: { orgId } });
			if (!result.found) throw new Error("Not found.");
			return result;
		},
		initialData: Route.useLoaderData(),
	});
	const data = home.data;

	return (
		<main className="page-wrap max-w-5xl space-y-brand-12 py-brand-12">
			<header className="space-y-2">
				<p className="type-label text-brand">Marketing Studio</p>
				<div className="flex flex-wrap items-end justify-between gap-brand-4">
					<h1 className="type-display-l">{data.orgName}</h1>
					<CreditsBadge credits={data.credits} />
				</div>
				<p className="type-body max-w-prose text-muted-foreground">
					Add a product with a few good photos, then turn it into promo images
					and videos. The product stays exactly as photographed; the scene
					around it is made for you.
				</p>
				<p className="type-caption text-muted-foreground">
					<Link to="/workspace/$orgId" params={{ orgId }}>
						brand brain
					</Link>{" "}
					· <Link to="/dashboard">workspaces</Link>
				</p>
			</header>

			{data.canEdit ? <NewProduct orgId={orgId} /> : null}

			<section className="space-y-brand-4">
				<h2 className="type-title">Products</h2>
				{data.products.length === 0 ? (
					<p className="type-body text-muted-foreground">
						No products yet.
						{data.canEdit
							? " Add one above to make your first promo."
							: " An owner or approver can add them."}
					</p>
				) : (
					<ul className="grid gap-brand-4 sm:grid-cols-2 lg:grid-cols-3">
						{data.products.map((product) => (
							<li key={product.id}>
								<Link
									to="/marketing/$orgId/$productId"
									params={{ orgId, productId: product.id }}
									className="block overflow-hidden rounded-lg border bg-card no-underline transition-colors hover:bg-accent"
								>
									{product.photoIds[0] ? (
										<img
											src={`/api/marketing/photo/${product.id}/${product.photoIds[0]}`}
											alt=""
											loading="lazy"
											className="aspect-square w-full bg-muted object-cover"
										/>
									) : null}
									<div className="space-y-1 p-brand-4">
										<h3 className="type-label">{product.name}</h3>
										<p className="type-caption text-muted-foreground">
											{product.photoIds.length} photo
											{product.photoIds.length === 1 ? "" : "s"} ·{" "}
											{product.promos} promo{product.promos === 1 ? "" : "s"}
										</p>
									</div>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}

function NewProduct({ orgId }: { orgId: string }) {
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [notes, setNotes] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [previews, setPreviews] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	// Object URLs hold the file in memory until revoked.
	useEffect(() => {
		const urls = files.map((file) => URL.createObjectURL(file));
		setPreviews(urls);
		return () => {
			for (const url of urls) URL.revokeObjectURL(url);
		};
	}, [files]);

	function addFiles(list: FileList | null) {
		if (!list) return;
		setError(null);
		const incoming = [...list].filter((file) => file.type.startsWith("image/"));
		const tooBig = incoming.find((file) => file.size > MAX_PHOTO_BYTES);
		if (tooBig) {
			setError(`${tooBig.name} is over 20 MB.`);
			return;
		}
		setFiles((current) => [...current, ...incoming].slice(0, MAX_PHOTOS));
	}

	async function submit() {
		setPending(true);
		setError(null);
		try {
			const form = new FormData();
			form.set("orgId", orgId);
			form.set("name", name.trim());
			form.set("notes", notes.trim());
			for (const file of files) form.append("photos", file);

			const response = await fetch("/api/marketing/products", {
				method: "POST",
				body: form,
			});
			const body = (await response.json().catch(() => ({}))) as {
				productId?: string;
				error?: string;
			};
			if (!response.ok || !body.productId) {
				throw new Error(body.error ?? "Could not add that product.");
			}
			await navigate({
				to: "/marketing/$orgId/$productId",
				params: { orgId, productId: body.productId },
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPending(false);
		}
	}

	return (
		<section className="space-y-brand-4 rounded-lg border bg-card p-brand-6">
			<h2 className="type-title">New product</h2>
			<form
				className="space-y-brand-4"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<div className="grid gap-brand-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="product-name">Name</Label>
						<Input
							id="product-name"
							required
							maxLength={120}
							value={name}
							placeholder="Yirgacheffe single origin, 250 g"
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="product-notes">About it (optional)</Label>
						<Textarea
							id="product-notes"
							maxLength={1000}
							rows={2}
							value={notes}
							placeholder="Floral, light roast. Sold in shops and online."
							onChange={(event) => setNotes(event.target.value)}
						/>
					</div>
				</div>

				<div className="space-y-2">
					<Label htmlFor="product-photos">
						Photos ({files.length}/{MAX_PHOTOS})
					</Label>
					<p className="type-caption text-muted-foreground">
						Clear, well-lit shots of the product itself — front, label, a second
						angle. Plain backgrounds work best.
					</p>
					<div className="flex flex-wrap gap-2">
						{previews.map((url, index) => (
							<div key={url} className="relative">
								<img
									src={url}
									alt={files[index]?.name ?? ""}
									className="size-24 rounded-md bg-muted object-cover"
								/>
								<button
									type="button"
									aria-label={`Remove ${files[index]?.name ?? "photo"}`}
									className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5"
									onClick={() =>
										setFiles((current) => current.filter((_, i) => i !== index))
									}
								>
									<X className="size-3.5" aria-hidden />
								</button>
							</div>
						))}
						{files.length < MAX_PHOTOS ? (
							<label
								htmlFor="product-photos"
								className="flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed type-caption text-muted-foreground hover:bg-accent"
							>
								<ImagePlus className="size-5" aria-hidden />
								Add
							</label>
						) : null}
						<input
							id="product-photos"
							type="file"
							accept="image/*"
							multiple
							className="sr-only"
							onChange={(event) => {
								addFiles(event.target.files);
								event.target.value = "";
							}}
						/>
					</div>
				</div>

				<div className="flex items-center gap-brand-4">
					<Button
						type="submit"
						disabled={pending || !name.trim() || files.length === 0}
					>
						{pending ? "Uploading…" : "Add product"}
					</Button>
					{error ? (
						<span className="type-caption text-destructive">{error}</span>
					) : null}
				</div>
			</form>
		</section>
	);
}
