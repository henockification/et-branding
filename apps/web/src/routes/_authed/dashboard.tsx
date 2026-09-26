import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { createTelegramInvite } from "#/server/invites";
import { createOrganization, listOrganizations } from "#/server/organizations";

export const Route = createFileRoute("/_authed/dashboard")({
	loader: () => listOrganizations(),
	component: Dashboard,
});

/**
 * Mints a Telegram invite on demand rather than showing a standing link: the
 * token is short-lived, so one rendered at page load would often be stale by
 * the time anyone sent it.
 */
function InviteButton({ orgId }: { orgId: string }) {
	const invite = useMutation({
		mutationFn: () => createTelegramInvite({ data: { orgId } }),
	});

	return (
		<div className="mt-brand-4 space-y-2">
			<Button
				variant="secondary"
				size="sm"
				onClick={() => invite.mutate()}
				disabled={invite.isPending}
			>
				{invite.isPending ? "Creating…" : "Invite to Telegram"}
			</Button>

			{invite.isError ? (
				<p className="type-caption text-destructive">{invite.error.message}</p>
			) : null}

			{invite.data ? (
				<div className="space-y-1">
					<p className="type-caption text-muted-foreground">
						Good for {invite.data.expiresInHours} hours.
					</p>
					<code className="block break-all text-xs">
						{invite.data.link ?? `/start ${invite.data.token}`}
					</code>
					{invite.data.link ? null : (
						<p className="type-caption text-muted-foreground">
							Set TELEGRAM_BOT_USERNAME to get a one-tap link instead of a
							command.
						</p>
					)}
				</div>
			) : null}
		</div>
	);
}

function Dashboard() {
	const { user } = Route.useRouteContext();
	const queryClient = useQueryClient();

	const organizations = useQuery({
		queryKey: ["organizations"],
		queryFn: () => listOrganizations(),
		initialData: Route.useLoaderData(),
	});

	const [name, setName] = useState("");

	const create = useMutation({
		mutationFn: (value: string) =>
			createOrganization({ data: { name: value } }),
		onSuccess: () => {
			setName("");
			queryClient.invalidateQueries({ queryKey: ["organizations"] });
		},
	});

	return (
		<main className="page-wrap space-y-brand-12 py-brand-12">
			<header className="space-y-2">
				<p className="type-label text-brand">Workspaces</p>
				<h1 className="type-display-l">
					{user.name ? `Hello, ${user.name}` : "Your workspaces"}
				</h1>
				<p className="type-body max-w-prose text-muted-foreground">
					Each workspace is one organization with one brand. The agent team
					works inside a workspace, and everything it produces belongs to it.
				</p>
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
						<Label htmlFor="org-name">Add a workspace</Label>
						<Input
							id="org-name"
							value={name}
							placeholder="Bunna Coffee"
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<Button type="submit" disabled={create.isPending || !name.trim()}>
						{create.isPending ? "Adding…" : "Add workspace"}
					</Button>
				</form>

				{create.isError ? (
					<p className="type-caption text-destructive">
						{create.error.message}
					</p>
				) : null}
			</section>

			<section>
				{organizations.data.length === 0 ? (
					<p className="type-body text-muted-foreground">
						No workspaces yet. Add one above and the agent team has a brand to
						work on.
					</p>
				) : (
					<ul className="grid gap-brand-4 sm:grid-cols-2">
						{organizations.data.map((org) => (
							<li key={org.id} className="rounded-lg border bg-card p-brand-6">
								<div className="flex items-start justify-between gap-2">
									<h2 className="type-title">{org.brandName ?? org.name}</h2>
									<span className="type-label text-muted-foreground">
										{org.role}
									</span>
								</div>
								<p className="type-caption text-muted-foreground">
									{org.brandSummary ??
										"No brand summary yet — the Brain is empty."}
								</p>
								<p className="mt-2 type-caption">
									<Link to="/workspace/$orgId" params={{ orgId: org.id }}>
										Brand brain
									</Link>
									{" · "}
									<Link to="/content/$orgId" params={{ orgId: org.id }}>
										Content
									</Link>
								</p>
								{org.role === "member" ? null : <InviteButton orgId={org.id} />}
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}
