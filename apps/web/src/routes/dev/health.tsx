import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { listModels, runSmokeAgent } from "#/server/agents";
import { checkDatabase } from "#/server/db";

export const Route = createFileRoute("/dev/health")({
	component: Home,
	loader: () => listModels(),
});

function Home() {
	const models = useQuery({
		queryKey: ["models"],
		queryFn: () => listModels(),
		initialData: Route.useLoaderData(),
	});

	const [prompt, setPrompt] = useState("Say hello and name the model you are.");

	const run = useMutation({
		mutationFn: (value: string) => runSmokeAgent({ data: { prompt: value } }),
	});

	const database = useMutation({ mutationFn: () => checkDatabase() });

	return (
		<main className="page-wrap space-y-brand-12 py-brand-12">
			<header className="rise-in space-y-3">
				<p className="type-label text-brand">Diagnostics</p>
				<h1 className="type-display-l">Health checks</h1>
				<p className="max-w-prose text-muted-foreground">
					Scaffolding, not product. Each panel exercises one path end to end: UI
					→ server function → agent → model → cost, and UI → Neon over Drizzle.
					Delete this route once real features cover the same ground.
				</p>
			</header>

			<Panel
				kicker="Agents"
				title="Agent smoke test"
				description="Runs on the cheap tier. Token counts and cost come back with the answer."
			>
				<div className="space-y-2">
					<Label htmlFor="prompt">Prompt</Label>
					<Textarea
						id="prompt"
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						rows={3}
					/>
				</div>
				<Button
					onClick={() => run.mutate(prompt)}
					disabled={run.isPending || prompt.trim().length === 0}
				>
					{run.isPending ? "Running…" : "Run agent"}
				</Button>

				{run.isError ? (
					<p className="text-destructive text-sm">{run.error.message}</p>
				) : null}

				{run.data ? (
					<div className="space-y-2 rounded-lg border bg-card p-4">
						<p className="whitespace-pre-wrap text-sm">{run.data.output}</p>
						<p className="text-muted-foreground text-xs">
							{run.data.modelId} · {run.data.inputTokens} in /{" "}
							{run.data.outputTokens} out · ${run.data.usd.toFixed(6)}
						</p>
					</div>
				) : null}
			</Panel>

			<Panel
				kicker="Database"
				title="Neon connection"
				description="Round-trips a trivial query through Drizzle on Neon's HTTP driver."
			>
				<Button
					variant="secondary"
					onClick={() => database.mutate()}
					disabled={database.isPending}
				>
					{database.isPending ? "Checking…" : "Check connection"}
				</Button>

				{database.isError ? (
					<p className="text-destructive text-sm">{database.error.message}</p>
				) : null}

				{database.data ? (
					database.data.ok ? (
						<p className="text-sm">
							<span className="font-medium text-primary">Connected.</span> Neon
							answered the probe query.
						</p>
					) : (
						<p className="text-destructive text-sm">{database.data.error}</p>
					)
				) : null}
			</Panel>

			<Panel
				kicker="Models"
				title="Model catalog"
				description="Agents ask for a tier, not a model. Swapping providers is an edit to packages/agents/src/models/catalog.ts."
			>
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-sm">
						<thead>
							<tr className="border-b text-left">
								<th className="py-2 pr-4 font-medium">Model</th>
								<th className="py-2 pr-4 font-medium">In $/1M</th>
								<th className="py-2 pr-4 font-medium">Out $/1M</th>
								<th className="py-2 font-medium">Notes</th>
							</tr>
						</thead>
						<tbody>
							{models.data?.map((model) => (
								<tr key={model.id} className="border-b last:border-0">
									<td className="py-2 pr-4 font-mono text-xs">{model.id}</td>
									<td className="py-2 pr-4">{model.usdPerMillionInput}</td>
									<td className="py-2 pr-4">{model.usdPerMillionOutput}</td>
									<td className="py-2 text-muted-foreground">{model.notes}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Panel>
		</main>
	);
}

function Panel({
	kicker,
	title,
	description,
	children,
}: {
	kicker: string;
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-brand-4 rounded-lg border bg-card p-brand-6">
			<div className="space-y-1">
				<p className="type-label text-brand">{kicker}</p>
				<h2 className="type-heading">{title}</h2>
				<p className="type-body max-w-prose text-muted-foreground">
					{description}
				</p>
			</div>
			{children}
		</section>
	);
}
