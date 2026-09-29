import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";
import {
	type ContentOrigin,
	type ContentStatus,
	fetchContentQueue,
} from "#/server/content-queue";

const FILTERS = [
	{ value: undefined, label: "All" },
	{ value: "draft" as const, label: "Waiting" },
	{ value: "approved" as const, label: "Approved" },
	{ value: "rejected" as const, label: "Rejected" },
	{ value: "published" as const, label: "Published" },
];

export const Route = createFileRoute("/_authed/content/$orgId")({
	validateSearch: z.object({
		status: z.enum(["draft", "approved", "rejected", "published"]).optional(),
		origin: z.enum(["ad_hoc", "weekly_plan"]).optional(),
	}),
	loaderDeps: ({ search }) => ({
		status: search.status,
		origin: search.origin,
	}),
	loader: async ({ params, deps }) => {
		const result = await fetchContentQueue({
			data: { orgId: params.orgId, status: deps.status, origin: deps.origin },
		});

		// A workspace the caller is not in is indistinguishable from one that
		// does not exist, and both render the app's own not-found page.
		if (!result.found) throw notFound();

		return result;
	},
	component: ContentQueue,
});

function ContentQueue() {
	const { orgId } = Route.useParams();
	const { status, origin } = Route.useSearch();
	const data = Route.useLoaderData();
	const { learning } = data;

	const totalLearning =
		learning.pastPosts +
		learning.approved +
		learning.corrections +
		learning.explainedRejections;

	return (
		<main className="page-wrap max-w-3xl space-y-brand-6 py-brand-12">
			<header className="space-y-2">
				<p className="type-label text-brand">Content</p>
				<h1 className="type-display-l">{data.orgName}</h1>
				<p className="type-caption text-muted-foreground">
					<Link to="/workspace/$orgId" params={{ orgId }}>
						brand brain
					</Link>{" "}
					· <Link to="/dashboard">workspaces</Link>
				</p>
			</header>

			<section className="rounded-lg border bg-card p-brand-6">
				<h2 className="type-label text-brand">
					What the next draft learns from
				</h2>
				<dl className="mt-brand-4 grid grid-cols-2 gap-brand-4 sm:grid-cols-4">
					<Stat label="Past posts" value={learning.pastPosts} />
					<Stat label="Approved" value={learning.approved} />
					<Stat label="Corrections" value={learning.corrections} />
					<Stat label="Rejections" value={learning.explainedRejections} />
				</dl>

				{totalLearning === 0 ? (
					<p className="mt-brand-4 type-caption text-muted-foreground">
						Nothing yet, so drafts come out generic. Forward past posts to the
						bot, or edit a draft instead of approving it.
					</p>
				) : null}

				{learning.silentRejections > 0 ? (
					<p className="mt-brand-4 type-caption text-muted-foreground">
						{learning.silentRejections} rejection
						{learning.silentRejections === 1 ? " has" : "s have"} no reason
						recorded, so{" "}
						{learning.silentRejections === 1 ? "it teaches" : "they teach"}{" "}
						nothing. Replying to the bot's “what was wrong?” is what turns a
						rejection into a lesson.
					</p>
				) : null}
			</section>

			<nav className="flex flex-wrap gap-2" aria-label="Filter by status">
				{FILTERS.map((filter) => {
					const active = status === filter.value;
					const count = filter.value ? data.counts[filter.value] : undefined;

					return (
						<Link
							key={filter.label}
							to="/content/$orgId"
							params={{ orgId }}
							search={{
								...(filter.value ? { status: filter.value } : {}),
								...(origin ? { origin } : {}),
							}}
							className={`rounded-md border px-3 py-1 type-caption no-underline ${
								active
									? "border-transparent bg-primary text-primary-foreground"
									: "text-muted-foreground"
							}`}
						>
							{filter.label}
							{count === undefined ? "" : ` ${count}`}
						</Link>
					);
				})}
			</nav>

			<nav className="flex flex-wrap gap-2" aria-label="Filter by origin">
				{ORIGIN_FILTERS.map((filter) => {
					const active = origin === filter.value;
					const count = filter.value
						? data.originCounts[filter.value]
						: undefined;

					return (
						<Link
							key={filter.label}
							to="/content/$orgId"
							params={{ orgId }}
							search={{
								...(status ? { status } : {}),
								...(filter.value ? { origin: filter.value } : {}),
							}}
							className={`rounded-md px-3 py-1 type-caption no-underline ${
								active
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground"
							}`}
						>
							{filter.label}
							{count === undefined ? "" : ` ${count}`}
						</Link>
					);
				})}
			</nav>

			{data.items.length === 0 ? (
				<p className="type-body text-muted-foreground">
					Nothing here. Ask the bot for a <code>/draft</code>.
				</p>
			) : (
				<ul className="space-y-brand-4">
					{data.items.map((item) => (
						<li
							key={item.id}
							className="space-y-brand-4 rounded-lg border bg-card p-brand-6"
						>
							<div className="flex flex-wrap items-center gap-2">
								<StatusBadge status={item.status as ContentStatus} />
								<OriginBadge origin={item.origin as ContentOrigin} />
								<span className="type-caption text-muted-foreground">
									{item.channel} · {item.language} ·{" "}
									{new Date(item.createdAt).toLocaleDateString()}
									{item.reviewedBy ? ` · ${item.reviewedBy}` : ""}
								</span>
							</div>

							{item.origin === "weekly_plan" ? (
								<p className="type-caption text-muted-foreground">
									<span className="text-brand">
										{item.plannedFor
											? new Date(item.plannedFor).toLocaleDateString(
													undefined,
													{
														weekday: "long",
														day: "numeric",
														month: "short",
													},
												)
											: "Planned"}
									</span>
									{item.angle ? ` — ${item.angle}` : ""}
								</p>
							) : null}

							{item.media?.some((media) => media.kind === "photo") ? (
								<PhotoPreview itemId={item.id} media={item.media} />
							) : null}

							<p className="type-body whitespace-pre-wrap">{item.body}</p>

							{/* The learning pair: what the agent wrote, and what a human made of it. */}
							{item.originalBody ? (
								<details className="rounded-md border border-dashed p-brand-4">
									<summary className="type-caption cursor-pointer text-muted-foreground">
										A human rewrote this — see the original
									</summary>
									<p className="mt-2 type-body whitespace-pre-wrap text-muted-foreground">
										{item.originalBody}
									</p>
								</details>
							) : null}

							{item.feedback ? (
								<p className="type-caption text-muted-foreground">
									<span className="text-brand">
										{item.status === "rejected" ? "Why rejected" : "Note"}:
									</span>{" "}
									{item.feedback}
								</p>
							) : null}

							{item.status === "rejected" && !item.feedback ? (
								<p className="type-caption text-muted-foreground">
									No reason recorded — this one teaches nothing.
								</p>
							) : null}
						</li>
					))}
				</ul>
			)}

			<p className="type-caption text-muted-foreground">
				Read-only. Approving, editing and rejecting happen in Telegram, where
				whoever is reviewing already is.
			</p>
		</main>
	);
}

const ORIGIN_FILTERS = [
	{ value: undefined, label: "Any source" },
	{ value: "weekly_plan" as const, label: "Weekly plan" },
	{ value: "ad_hoc" as const, label: "Asked for" },
];

/** Where an item came from — the plan proposed it, or someone asked for it. */
function OriginBadge({ origin }: { origin: ContentOrigin }) {
	if (origin !== "weekly_plan") return null;

	return (
		<span className="rounded-md bg-accent px-2 py-0.5 type-label text-accent-foreground">
			weekly plan
		</span>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div>
			<dt className="type-caption text-muted-foreground">{label}</dt>
			<dd className="type-heading">{value}</dd>
		</div>
	);
}

function StatusBadge({ status }: { status: ContentStatus }) {
	const tone: Record<ContentStatus, string> = {
		draft: "bg-secondary text-secondary-foreground",
		approved: "bg-primary text-primary-foreground",
		rejected: "bg-muted text-muted-foreground",
		published: "bg-brand-deep text-on-brand",
	};

	return (
		<span className={`rounded-md px-2 py-0.5 type-label ${tone[status]}`}>
			{status}
		</span>
	);
}

/**
 * The photo that will go out with the post, as the human chose it in Telegram.
 *
 * The other version is one click away, so whoever reviews the queue can see
 * what the polish actually did.
 */
function PhotoPreview({
	itemId,
	media,
}: {
	itemId: string;
	media: readonly { kind: "photo"; selected: "original" | "polished" }[];
}) {
	const photo = media.find((m) => m.kind === "photo");
	if (!photo) return null;

	const other = photo.selected === "polished" ? "original" : "polished";

	return (
		<figure className="space-y-2">
			<img
				src={`/api/media/${itemId}`}
				alt="Sent with this post"
				loading="lazy"
				className="max-h-96 w-full rounded-md object-contain bg-muted"
			/>
			<figcaption className="type-caption text-muted-foreground">
				Posting the {photo.selected} ·{" "}
				<a
					href={`/api/media/${itemId}?version=${other}`}
					target="_blank"
					rel="noreferrer"
				>
					see the {other}
				</a>
			</figcaption>
		</figure>
	);
}
