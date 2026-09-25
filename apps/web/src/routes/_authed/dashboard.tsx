import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { createBrand, listBrands } from "#/server/brands";

export const Route = createFileRoute("/_authed/dashboard")({
	loader: () => listBrands(),
	component: Dashboard,
});

function Dashboard() {
	const { user } = Route.useRouteContext();
	const queryClient = useQueryClient();

	const brands = useQuery({
		queryKey: ["brands"],
		queryFn: () => listBrands(),
		initialData: Route.useLoaderData(),
	});

	const [name, setName] = useState("");

	const create = useMutation({
		mutationFn: (value: string) => createBrand({ data: { name: value } }),
		onSuccess: () => {
			setName("");
			queryClient.invalidateQueries({ queryKey: ["brands"] });
		},
	});

	return (
		<main className="page-wrap space-y-brand-12 py-brand-12">
			<header className="space-y-2">
				<p className="type-label text-brand">Your brands</p>
				<h1 className="type-display-l">
					{user.name ? `Hello, ${user.name}` : "Your brands"}
				</h1>
			</header>

			<section className="space-y-brand-4">
				<form
					className="flex flex-wrap items-end gap-brand-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (name.trim()) create.mutate(name.trim());
					}}
				>
					<div className="min-w-56 flex-1 space-y-2">
						<Label htmlFor="brand-name">Add a brand</Label>
						<Input
							id="brand-name"
							value={name}
							placeholder="Bunna Coffee"
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<Button type="submit" disabled={create.isPending || !name.trim()}>
						{create.isPending ? "Adding…" : "Add brand"}
					</Button>
				</form>

				{create.isError ? (
					<p className="type-caption text-destructive">
						{create.error.message}
					</p>
				) : null}
			</section>

			<section>
				{brands.data.length === 0 ? (
					<p className="type-body text-muted-foreground">
						No brands yet. Add one above and the agent team has something to
						work on.
					</p>
				) : (
					<ul className="grid gap-brand-4 sm:grid-cols-2">
						{brands.data.map((item) => (
							<li key={item.id} className="rounded-lg border bg-card p-brand-6">
								<h2 className="type-title">{item.name}</h2>
								<p className="type-caption text-muted-foreground">
									{item.summary ?? "No summary yet."}
								</p>
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}
