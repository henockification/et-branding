import { MODULES } from "@et/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Clapperboard, Lock, PenLine } from "lucide-react";
import { Button } from "#/components/ui/button";
import { createTelegramInvite } from "#/server/invites";
import type { ModuleState } from "#/server/modules";
import { listOrganizations } from "#/server/organizations";

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

const MODULE_ICONS = {
	content: PenLine,
	marketing: Clapperboard,
} as const;

/**
 * One product in the shop window. Open modules link in; closed ones say what
 * they would do and how to get them, since payment is arranged with us.
 */
function ModuleTile({ orgId, state }: { orgId: string; state: ModuleState }) {
	const spec = MODULES[state.module];
	const Icon = MODULE_ICONS[state.module];

	const body = (
		<>
			<div className="flex items-center gap-2">
				<Icon className="size-4 text-brand" aria-hidden />
				<span className="type-label">{spec.label}</span>
				{state.open ? null : (
					<Lock
						className="ml-auto size-3.5 text-muted-foreground"
						aria-hidden
					/>
				)}
			</div>
			<p className="mt-1 type-caption text-muted-foreground">
				{state.open
					? state.credits
						? `${state.credits.remaining} of ${state.credits.monthly} credits left this month`
						: spec.description
					: state.closedReason === "expired"
						? "Expired — ask us to renew it."
						: `${spec.description} Not on your plan — ask us to add it.`}
			</p>
		</>
	);

	const className =
		"block rounded-md border p-brand-4 no-underline transition-colors";

	if (!state.open) {
		return (
			<div className={`${className} border-dashed opacity-80`}>{body}</div>
		);
	}

	return state.module === "marketing" ? (
		<Link
			to="/marketing/$orgId"
			params={{ orgId }}
			className={`${className} hover:bg-accent`}
		>
			{body}
		</Link>
	) : (
		<Link
			to="/content/$orgId"
			params={{ orgId }}
			className={`${className} hover:bg-accent`}
		>
			{body}
		</Link>
	);
}

function Dashboard() {
	const { user } = Route.useRouteContext();

	const organizations = useQuery({
		queryKey: ["organizations"],
		queryFn: () => listOrganizations(),
		initialData: Route.useLoaderData(),
	});

	const { isAdmin, organizations: workspaces } = organizations.data;

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
				{isAdmin ? (
					<p className="type-body">
						<Link to="/admin">Admin console</Link> — create workspaces, and
						manage clients, billing and suspensions.
					</p>
				) : null}
			</header>

			<section>
				{workspaces.length === 0 ? (
					<p className="type-body text-muted-foreground">
						{isAdmin
							? "You are not in any workspace yourself. Create one of your own from the admin console."
							: "You are not in a workspace yet. Open the invite link you were sent, or ask whoever runs your brand here to invite you."}
					</p>
				) : (
					<ul className="grid gap-brand-4 sm:grid-cols-2">
						{workspaces.map((org) => (
							<li key={org.id} className="rounded-lg border bg-card p-brand-6">
								<div className="flex items-start justify-between gap-2">
									<h2 className="type-title">{org.brandName ?? org.name}</h2>
									<span className="type-label text-muted-foreground">
										{org.role}
									</span>
								</div>

								{org.status === "suspended" ? (
									<div className="mt-2 space-y-1">
										<p className="type-caption text-destructive">
											Suspended — nothing here opens until it is reactivated.
											Your content is kept.
										</p>
										{org.suspendedReason ? (
											<p className="type-caption text-muted-foreground">
												{org.suspendedReason}
											</p>
										) : null}
									</div>
								) : (
									<>
										<p className="type-caption text-muted-foreground">
											{org.brandSummary ??
												"No brand summary yet — the Brain is empty."}
										</p>
										<div className="mt-brand-4 grid gap-2">
											{org.modules.map((state) => (
												<ModuleTile
													key={state.module}
													orgId={org.id}
													state={state}
												/>
											))}
										</div>
										<p className="mt-brand-4 type-caption">
											<Link to="/workspace/$orgId" params={{ orgId: org.id }}>
												Brand brain
											</Link>
											{" · "}
											<Link
												to="/workspace/$orgId"
												params={{ orgId: org.id }}
												hash="people"
											>
												People
											</Link>
										</p>
										{org.role === "owner" ? (
											<InviteButton orgId={org.id} />
										) : null}
									</>
								)}
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}
