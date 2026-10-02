import {
	PROMO_ASPECT_RATIOS,
	PROMO_DURATIONS,
	PROMO_KIND_LABELS,
	PROMO_KINDS,
	type PromoAspectRatio,
	type PromoDuration,
	type PromoKind,
	promoCreditCost,
	VIDEO_ASPECT_RATIOS,
} from "@et/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { CreditsBadge } from "#/components/credits-badge";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import {
	deleteProduct,
	fetchProduct,
	fetchVoices,
	startGeneration,
} from "#/server/marketing/studio";

export const Route = createFileRoute("/_authed/marketing/$orgId/$productId")({
	loader: async ({ params }) => {
		const result = await fetchProduct({
			data: { orgId: params.orgId, productId: params.productId },
		});
		if (!result.found) throw notFound();
		return result;
	},
	component: ProductPage,
});

type ProductData = Awaited<ReturnType<typeof fetchProduct>> & { found: true };
type Promo = ProductData["generations"][number];

const FINISHED = new Set(["completed", "failed"]);

/** How often to look again while something is still being made. */
const POLL_MS = 5000;

function ProductPage() {
	const { orgId, productId } = Route.useParams();
	const queryKey = ["marketing-product", orgId, productId];
	const product = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await fetchProduct({ data: { orgId, productId } });
			if (!result.found) throw new Error("Not found.");
			return result;
		},
		initialData: Route.useLoaderData(),
		refetchInterval: (query) =>
			query.state.data?.generations.some((g) => !FINISHED.has(g.status))
				? POLL_MS
				: false,
	});
	const data = product.data;
	const [script, setScript] = useState("");

	return (
		<main className="page-wrap max-w-5xl space-y-brand-12 py-brand-12">
			<header className="space-y-2">
				<p className="type-label text-brand">Marketing Studio</p>
				<div className="flex flex-wrap items-end justify-between gap-brand-4">
					<h1 className="type-display-l">{data.product.name}</h1>
					<CreditsBadge credits={data.credits} />
				</div>
				{data.product.notes ? (
					<p className="type-body max-w-prose text-muted-foreground">
						{data.product.notes}
					</p>
				) : null}
				<p className="type-caption text-muted-foreground">
					<Link to="/marketing/$orgId" params={{ orgId }}>
						all products
					</Link>{" "}
					· <Link to="/dashboard">workspaces</Link>
				</p>
			</header>

			<ul className="flex flex-wrap gap-2">
				{data.product.photoIds.map((photoId) => (
					<li key={photoId}>
						<img
							src={`/api/marketing/photo/${productId}/${photoId}`}
							alt={data.product.name}
							className="size-28 rounded-md bg-muted object-cover"
						/>
					</li>
				))}
			</ul>

			{data.canEdit ? (
				<CreatePromo
					orgId={orgId}
					productId={productId}
					remaining={data.credits?.remaining ?? 0}
					providerReady={data.providerReady}
					voiceReady={data.voiceReady}
					script={script}
					onScriptChange={setScript}
				/>
			) : null}

			<section className="space-y-brand-4">
				<h2 className="type-title">Promos</h2>
				{data.generations.length === 0 ? (
					<p className="type-body text-muted-foreground">Nothing made yet.</p>
				) : (
					<ul className="grid gap-brand-6 md:grid-cols-2">
						{data.generations.map((promo) => (
							<PromoCard
								key={promo.id}
								promo={promo}
								productName={data.product.name}
								onReuseScript={
									data.canEdit
										? (text) => {
												setScript(text);
												window.scrollTo({ top: 0, behavior: "smooth" });
											}
										: undefined
								}
							/>
						))}
					</ul>
				)}
			</section>

			{data.canEdit ? (
				<DeleteProduct orgId={orgId} productId={productId} />
			) : null}
		</main>
	);
}

/** A row of mutually exclusive choices, like the admin console's toggles. */
function Choice<T extends string | number>({
	label,
	options,
	value,
	onChange,
	render = String,
}: {
	label: string;
	options: readonly T[];
	value: T;
	onChange: (value: T) => void;
	render?: (value: T) => string;
}) {
	return (
		<div className="space-y-2">
			<p className="type-label">{label}</p>
			<div
				className="flex flex-wrap gap-2"
				role="radiogroup"
				aria-label={label}
			>
				{options.map((option) => (
					<Button
						key={String(option)}
						type="button"
						size="sm"
						variant={option === value ? "default" : "outline"}
						role="radio"
						aria-checked={option === value}
						onClick={() => onChange(option)}
					>
						{render(option)}
					</Button>
				))}
			</div>
		</div>
	);
}

function CreatePromo({
	orgId,
	productId,
	remaining,
	providerReady,
	voiceReady,
	script,
	onScriptChange,
}: {
	orgId: string;
	productId: string;
	remaining: number;
	providerReady: boolean;
	voiceReady: boolean;
	script: string;
	onScriptChange: (script: string) => void;
}) {
	const queryClient = useQueryClient();
	const [kind, setKind] = useState<PromoKind>("image");
	const [aspect, setAspect] = useState<PromoAspectRatio>("4:5");
	const [duration, setDuration] = useState<PromoDuration>(8);
	const [voiceId, setVoiceId] = useState("");
	const [notes, setNotes] = useState("");

	const isVideo = kind !== "image";
	const aspectOptions: readonly PromoAspectRatio[] = isVideo
		? VIDEO_ASPECT_RATIOS
		: PROMO_ASPECT_RATIOS;
	// Switching to video from an image-only shape lands on vertical video.
	const aspectRatio = aspectOptions.includes(aspect) ? aspect : "9:16";
	const cost = promoCreditCost(kind, duration);

	const voices = useQuery({
		queryKey: ["marketing-voices", orgId],
		queryFn: () => fetchVoices({ data: { orgId } }),
		enabled: kind === "video_voice" && voiceReady,
		staleTime: 60 * 60 * 1000,
	});

	const start = useMutation({
		mutationFn: () =>
			startGeneration({
				data: {
					orgId,
					productId,
					kind,
					aspectRatio,
					durationSecs: isVideo ? duration : undefined,
					voiceId: kind === "video_voice" && voiceId ? voiceId : undefined,
					notes: notes.trim() || undefined,
					script:
						kind === "video_voice" && script.trim() ? script.trim() : undefined,
				},
			}),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: ["marketing-product", orgId, productId],
			}),
	});

	return (
		<section className="space-y-brand-6 rounded-lg border bg-card p-brand-6">
			<h2 className="type-title">Create a promo</h2>

			{providerReady ? null : (
				<p className="type-caption text-destructive">
					Promo generation is not switched on yet. Check back soon.
				</p>
			)}

			<form
				className="space-y-brand-6"
				onSubmit={(event) => {
					event.preventDefault();
					start.mutate();
				}}
			>
				<Choice
					label="What to make"
					options={PROMO_KINDS}
					value={kind}
					onChange={setKind}
					render={(k) => PROMO_KIND_LABELS[k]}
				/>
				<Choice
					label="Shape"
					options={aspectOptions}
					value={aspectRatio}
					onChange={setAspect}
				/>
				{isVideo ? (
					<Choice
						label="Length"
						options={PROMO_DURATIONS}
						value={duration}
						onChange={setDuration}
						render={(s) => `${s}s`}
					/>
				) : null}

				{kind === "video_voice" ? (
					<div className="grid gap-brand-4 sm:grid-cols-2">
						<p className="type-caption text-muted-foreground sm:col-span-2">
							The video narrates your script itself. The voice you pick here
							records the same script as a separate MP3, for when you edit the
							promo yourself.
						</p>
						<div className="space-y-2">
							<Label htmlFor="promo-voice">Voice</Label>
							<select
								id="promo-voice"
								className="h-9 w-full rounded-md border border-input bg-transparent px-3 type-caption"
								value={voiceId}
								onChange={(event) => setVoiceId(event.target.value)}
							>
								<option value="">Our default narrator</option>
								{(voices.data ?? []).map((voice) => (
									<option key={voice.id} value={voice.id}>
										{voice.name}
										{voice.description ? ` — ${voice.description}` : ""}
									</option>
								))}
							</select>
							{voices.isError ? (
								<p className="type-caption text-destructive">
									Could not load voices; the default narrator will be used.
								</p>
							) : null}
						</div>
						<div className="space-y-2">
							<Label htmlFor="promo-script">Voiceover (optional)</Label>
							<Textarea
								id="promo-script"
								rows={3}
								maxLength={600}
								value={script}
								placeholder="Leave empty and we write it for you."
								onChange={(event) => onScriptChange(event.target.value)}
							/>
							<p className="type-caption text-muted-foreground">
								About {Math.floor(duration * 2.3)} words fit in {duration}{" "}
								seconds.
							</p>
						</div>
					</div>
				) : null}

				<div className="space-y-2">
					<Label htmlFor="promo-notes">Direction (optional)</Label>
					<Textarea
						id="promo-notes"
						rows={2}
						maxLength={500}
						value={notes}
						placeholder="On a café table in morning light. Mention free delivery this week."
						onChange={(event) => setNotes(event.target.value)}
					/>
				</div>

				<div className="flex flex-wrap items-center gap-brand-4">
					<Button
						type="submit"
						disabled={start.isPending || !providerReady || cost > remaining}
					>
						{start.isPending
							? "Making it…"
							: `Make it · ${cost} credit${cost === 1 ? "" : "s"}`}
					</Button>
					{cost > remaining ? (
						<span className="type-caption text-muted-foreground">
							Not enough credits left this month.
						</span>
					) : null}
					{start.isError ? (
						<span className="type-caption text-destructive">
							{start.error.message}
						</span>
					) : null}
					{start.isPending ? (
						<span className="type-caption text-muted-foreground">
							Studying the photos and writing the brief — up to a minute.
						</span>
					) : null}
					{start.isSuccess && !start.isPending ? (
						<span className="type-caption text-primary">
							{kind === "image"
								? "Done — see it below."
								: "Rendering — the video appears below in a few minutes."}
						</span>
					) : null}
				</div>
			</form>
		</section>
	);
}

function stepLabel(promo: Promo): string {
	switch (promo.status) {
		case "queued":
			return "Queued";
		case "briefing":
			return "Studying the product and writing the brief";
		case "voicing":
			return "Recording the voiceover";
		case "rendering":
			return promo.kind === "image"
				? "Rendering the image"
				: "Rendering the video";
		case "storing":
			return "Saving";
		case "completed":
			return "Ready";
		case "failed":
			return "Failed";
	}
}

function PromoCard({
	promo,
	productName,
	onReuseScript,
}: {
	promo: Promo;
	productName: string;
	onReuseScript?: (script: string) => void;
}) {
	const src = `/api/marketing/output/${promo.id}`;
	const isVideo = promo.outputMime?.startsWith("video/");

	return (
		<li className="space-y-brand-4 rounded-lg border bg-card p-brand-4">
			<div className="flex flex-wrap items-center justify-between gap-2 type-caption">
				<span className="type-label">
					{PROMO_KIND_LABELS[promo.kind]} · {promo.settings.aspectRatio}
					{promo.settings.durationSecs
						? ` · ${promo.settings.durationSecs}s`
						: ""}
				</span>
				<span className="text-muted-foreground">
					{new Date(promo.createdAt).toLocaleString()}
				</span>
			</div>

			{promo.status === "completed" ? (
				isVideo ? (
					// biome-ignore lint/a11y/useMediaCaption: generated promo; the voiceover script is shown below.
					<video
						src={src}
						controls
						playsInline
						preload="metadata"
						className="max-h-[32rem] w-full rounded-md bg-muted"
					/>
				) : (
					<img
						src={src}
						alt={`Promo for ${productName}`}
						loading="lazy"
						className="max-h-[32rem] w-full rounded-md bg-muted object-contain"
					/>
				)
			) : (
				<div
					className="flex aspect-video items-center justify-center rounded-md bg-muted p-brand-4 text-center type-caption"
					aria-live="polite"
				>
					{promo.status === "failed" ? (
						<span className="text-destructive">
							{promo.error ?? "This promo could not be made."}
						</span>
					) : (
						<span className="animate-pulse text-muted-foreground">
							{stepLabel(promo)}…
						</span>
					)}
				</div>
			)}

			{promo.hasVoiceover ? (
				<figure className="space-y-1">
					<figcaption className="type-caption text-muted-foreground">
						Voiceover (MP3)
					</figcaption>
					{/* biome-ignore lint/a11y/useMediaCaption: the script is shown below. */}
					<audio
						src={`${src}?file=voiceover`}
						controls
						preload="none"
						className="w-full"
					/>
				</figure>
			) : null}

			{promo.voiceoverScript ? (
				<blockquote className="border-l-2 pl-brand-4 type-caption text-muted-foreground">
					{promo.voiceoverScript}
				</blockquote>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				{promo.status === "completed" ? (
					<Button asChild size="sm" variant="secondary">
						<a href={`${src}?download=1`}>
							<Download className="size-4" aria-hidden /> Download
						</a>
					</Button>
				) : null}
				{promo.hasVoiceover ? (
					<Button asChild size="sm" variant="outline">
						<a href={`${src}?file=voiceover&download=1`}>
							<Download className="size-4" aria-hidden /> Voiceover
						</a>
					</Button>
				) : null}
				{promo.voiceoverScript && onReuseScript ? (
					<Button
						size="sm"
						variant="outline"
						onClick={() => onReuseScript(promo.voiceoverScript ?? "")}
					>
						Edit this voiceover
					</Button>
				) : null}
				<span className="ml-auto type-caption text-muted-foreground">
					{promo.status === "failed"
						? "credits returned"
						: `${promo.credits} credit${promo.credits === 1 ? "" : "s"}`}
				</span>
			</div>
		</li>
	);
}

function DeleteProduct({
	orgId,
	productId,
}: {
	orgId: string;
	productId: string;
}) {
	const navigate = useNavigate();
	const remove = useMutation({
		mutationFn: () => deleteProduct({ data: { orgId, productId } }),
		onSuccess: () => navigate({ to: "/marketing/$orgId", params: { orgId } }),
	});

	return (
		<section className="border-t pt-brand-6">
			<Button
				variant="destructive"
				size="sm"
				disabled={remove.isPending}
				onClick={() => {
					if (
						window.confirm(
							"Delete this product, its photos and every promo made from it?",
						)
					) {
						remove.mutate();
					}
				}}
			>
				Delete product
			</Button>
			{remove.isError ? (
				<p className="mt-2 type-caption text-destructive">
					{remove.error.message}
				</p>
			) : null}
		</section>
	);
}
