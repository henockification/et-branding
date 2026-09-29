import { linesToList, listToLines, profileCompleteness } from "@et/core";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { PastPosts } from "#/components/past-posts";
import { People } from "#/components/people";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { fetchBrandProfile, saveBrandProfile } from "#/server/brand-profile";

export const Route = createFileRoute("/_authed/workspace/$orgId")({
	loader: async ({ params }) => {
		const result = await fetchBrandProfile({ data: { orgId: params.orgId } });
		if (!result.found) throw notFound();
		return result;
	},
	component: WorkspaceBrand,
});

function WorkspaceBrand() {
	const { orgId } = Route.useParams();
	const loaded = Route.useLoaderData();
	const readOnly = !loaded.canEdit;

	const [name, setName] = useState(loaded.name);
	const [summary, setSummary] = useState(loaded.summary);
	const [tone, setTone] = useState(loaded.voice.tone ?? "");
	const [dos, setDos] = useState(listToLines(loaded.voice.dos));
	const [donts, setDonts] = useState(listToLines(loaded.voice.donts));
	const [primary, setPrimary] = useState(loaded.audience.primary ?? "");
	const [segments, setSegments] = useState(
		listToLines(loaded.audience.segments),
	);
	const [services, setServices] = useState(listToLines(loaded.services.items));

	const save = useMutation({
		mutationFn: () =>
			saveBrandProfile({
				data: {
					orgId,
					profile: {
						name: name.trim(),
						summary: summary.trim() || undefined,
						voice: {
							tone: tone.trim() || undefined,
							dos: linesToList(dos),
							donts: linesToList(donts),
						},
						audience: {
							primary: primary.trim() || undefined,
							segments: linesToList(segments),
						},
						services: { items: linesToList(services) },
					},
				},
			}),
	});

	// Recomputed from what is on screen, so the meter responds as you type.
	const progress = profileCompleteness({
		summary,
		voice: { tone, dos: linesToList(dos), donts: linesToList(donts) },
		audience: { primary, segments: linesToList(segments) },
		services: { items: linesToList(services) },
	});

	return (
		<main className="page-wrap max-w-2xl space-y-brand-12 py-brand-12">
			<header className="space-y-2">
				<p className="type-label text-brand">Brand brain</p>
				<h1 className="type-display-l">{loaded.orgName}</h1>
				<p className="type-body max-w-prose text-muted-foreground">
					Everything here is handed to the agents before they write a word. The
					fuller it is, the less generic the drafts — an empty profile produces
					copy that could belong to anyone.
				</p>
				<p className="type-caption text-muted-foreground">
					{progress.filled} of {progress.total} sections filled ·{" "}
					<Link to="/content/$orgId" params={{ orgId }}>
						content
					</Link>{" "}
					·<Link to="/dashboard"> workspaces</Link>
				</p>
			</header>

			<form
				className="space-y-brand-6"
				onSubmit={(event) => {
					event.preventDefault();
					if (!readOnly) save.mutate();
				}}
			>
				<Field id="name" label="Brand name" hint="What the agents call it.">
					<Input
						id="name"
						value={name}
						maxLength={120}
						required
						disabled={readOnly}
						onChange={(event) => setName(event.target.value)}
					/>
				</Field>

				<Field
					id="summary"
					label="What it is"
					hint="One paragraph an agent can lead with. What the business does, for whom."
				>
					<Textarea
						id="summary"
						rows={4}
						value={summary}
						disabled={readOnly}
						onChange={(event) => setSummary(event.target.value)}
					/>
				</Field>

				<Field
					id="tone"
					label="Voice"
					hint="How it sounds. Confident? Warm? Dry? Write it as you would describe it to a new copywriter."
				>
					<Textarea
						id="tone"
						rows={3}
						value={tone}
						disabled={readOnly}
						onChange={(event) => setTone(event.target.value)}
					/>
				</Field>

				<Field
					id="dos"
					label="Always"
					hint="One per line. Short sentences. Lead with the outcome."
				>
					<Textarea
						id="dos"
						rows={4}
						value={dos}
						disabled={readOnly}
						onChange={(event) => setDos(event.target.value)}
					/>
				</Field>

				<Field
					id="donts"
					label="Never"
					hint="One per line. These matter more than the do's — they are what stops a draft sounding wrong."
				>
					<Textarea
						id="donts"
						rows={4}
						value={donts}
						disabled={readOnly}
						onChange={(event) => setDonts(event.target.value)}
					/>
				</Field>

				<Field id="primary" label="Audience" hint="Who this is mainly for.">
					<Textarea
						id="primary"
						rows={3}
						value={primary}
						disabled={readOnly}
						onChange={(event) => setPrimary(event.target.value)}
					/>
				</Field>

				<Field
					id="segments"
					label="Segments"
					hint="One per line. Groups worth addressing differently."
				>
					<Textarea
						id="segments"
						rows={3}
						value={segments}
						disabled={readOnly}
						onChange={(event) => setSegments(event.target.value)}
					/>
				</Field>

				<Field id="services" label="What it sells" hint="One per line.">
					<Textarea
						id="services"
						rows={4}
						value={services}
						disabled={readOnly}
						onChange={(event) => setServices(event.target.value)}
					/>
				</Field>

				{readOnly ? (
					<p className="type-caption text-muted-foreground">
						You have view-only access to this workspace.
					</p>
				) : (
					<div className="flex items-center gap-brand-4">
						<Button type="submit" disabled={save.isPending || !name.trim()}>
							{save.isPending ? "Saving…" : "Save brand"}
						</Button>
						{save.isSuccess ? (
							<span className="type-caption text-primary">Saved.</span>
						) : null}
						{save.isError ? (
							<span className="type-caption text-destructive">
								{save.error.message}
							</span>
						) : null}
					</div>
				)}
			</form>

			<PastPosts orgId={orgId} />

			<People orgId={orgId} />
		</main>
	);
}

function Field({
	id,
	label,
	hint,
	children,
}: {
	id: string;
	label: string;
	hint: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<p className="type-caption text-muted-foreground">{hint}</p>
			{children}
		</div>
	);
}
