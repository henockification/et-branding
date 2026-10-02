import { MODULE_KEYS, MODULES, type ModuleKey } from "@et/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { InviteLink } from "#/components/people";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import {
	adjustModuleCredits,
	adminWithdrawInvite,
	createWorkspace,
	fetchAdminConsole,
	inviteOwner,
	setWorkspaceStatus,
	updateBilling,
	updateModule,
	updateTeamLimits,
} from "#/server/admin";

/**
 * The platform admin's console.
 *
 * Every workspace as an account — status, billing, seats, usage — and never
 * as content. Opening a workspace's brand or drafts is only possible for its
 * own members, the admin included only in workspaces that are theirs.
 */
export const Route = createFileRoute("/_authed/admin")({
	loader: async () => {
		const result = await fetchAdminConsole();
		// Not an admin: the page does not exist, as far as they can tell.
		if (!result.allowed) throw notFound();
		return result;
	},
	component: AdminConsole,
});

type Console = Awaited<ReturnType<typeof fetchAdminConsole>> & {
	allowed: true;
};
type Workspace = Console["workspaces"][number];
type WorkspaceModule = Workspace["modules"][number];

const QUERY_KEY = ["admin-console"];

function money(amount: number | string | null, currency: string): string {
	if (amount === null) return "—";
	return `${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function AdminConsole() {
	const consoleQuery = useQuery({
		queryKey: QUERY_KEY,
		queryFn: async () => {
			const result = await fetchAdminConsole();
			if (!result.allowed) throw new Error("Not allowed.");
			return result;
		},
		initialData: Route.useLoaderData(),
	});

	const { workspaces } = consoleQuery.data;
	const active = workspaces.filter((w) => w.status === "active");
	const overdue = workspaces.filter((w) => w.overdue);
	const spend = workspaces.reduce(
		(sum, w) => sum + w.modelUsdThisMonth + w.promoUsdThisMonth,
		0,
	);

	// Revenue by currency: mixing ETB and USD into one number would be a lie.
	const revenue = new Map<string, number>();
	for (const w of active) {
		if (w.priceMonthly === null) continue;
		revenue.set(
			w.currency,
			(revenue.get(w.currency) ?? 0) + Number(w.priceMonthly),
		);
	}

	return (
		<main className="page-wrap space-y-brand-12 py-brand-12">
			<header className="space-y-2">
				<p className="type-label text-brand">Admin console</p>
				<h1 className="type-display-l">Workspaces</h1>
				<p className="type-body text-muted-foreground">
					{workspaces.length} workspaces · {active.length} active ·{" "}
					{overdue.length} overdue ·{" "}
					{revenue.size > 0
						? [...revenue]
								.map(([currency, total]) => money(total, currency))
								.join(" + ")
						: "no prices set"}{" "}
					a month · model cost this month ${spend.toFixed(4)}
				</p>
			</header>

			<NewWorkspace />

			<ul className="space-y-brand-6">
				{workspaces.map((workspace) => (
					<WorkspaceCard key={workspace.id} workspace={workspace} />
				))}
			</ul>
		</main>
	);
}

function useRefresh() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
}

function NewWorkspace() {
	const refresh = useRefresh();
	const [kind, setKind] = useState<"client" | "own">("client");
	const [name, setName] = useState("");
	const [ownerEmail, setOwnerEmail] = useState("");
	const [seats, setSeats] = useState("5");
	const [modules, setModules] = useState<ModuleKey[]>(["content"]);

	const create = useMutation({
		mutationFn: () =>
			createWorkspace({
				data:
					kind === "own"
						? { kind, name: name.trim(), modules }
						: {
								kind,
								name: name.trim(),
								ownerEmail: ownerEmail.trim(),
								seatLimit: seats.trim() ? Number(seats) : null,
								modules,
							},
			}),
		onSuccess: () => {
			setName("");
			setOwnerEmail("");
			refresh();
		},
	});

	return (
		<section className="space-y-brand-4 rounded-lg border bg-card p-brand-6">
			<h2 className="type-title">New workspace</h2>

			<div
				className="flex gap-2"
				role="radiogroup"
				aria-label="Whose workspace"
			>
				<Button
					type="button"
					size="sm"
					variant={kind === "client" ? "default" : "outline"}
					aria-pressed={kind === "client"}
					onClick={() => setKind("client")}
				>
					For a client
				</Button>
				<Button
					type="button"
					size="sm"
					variant={kind === "own" ? "default" : "outline"}
					aria-pressed={kind === "own"}
					onClick={() => setKind("own")}
				>
					My own
				</Button>
			</div>
			<p className="type-caption text-muted-foreground">
				{kind === "client"
					? "The client's owner gets an invite and runs the workspace. You are not a member of it; you manage it from here."
					: "You are its owner, like any member. Use this for your own brands."}
			</p>

			<form
				className="flex flex-wrap items-end gap-brand-4"
				onSubmit={(event) => {
					event.preventDefault();
					create.mutate();
				}}
			>
				<div className="min-w-48 flex-1 space-y-2">
					<Label htmlFor="ws-name">Name</Label>
					<Input
						id="ws-name"
						required
						maxLength={80}
						value={name}
						placeholder="Bunna Coffee"
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				{kind === "client" ? (
					<>
						<div className="min-w-56 flex-1 space-y-2">
							<Label htmlFor="ws-owner">Client owner's email</Label>
							<Input
								id="ws-owner"
								type="email"
								required
								value={ownerEmail}
								placeholder="owner@client.com"
								onChange={(event) => setOwnerEmail(event.target.value)}
							/>
						</div>
						<div className="w-28 space-y-2">
							<Label htmlFor="ws-seats">Seats</Label>
							<Input
								id="ws-seats"
								type="number"
								min={1}
								max={500}
								value={seats}
								placeholder="No limit"
								onChange={(event) => setSeats(event.target.value)}
							/>
						</div>
					</>
				) : null}
				<fieldset className="space-y-2">
					<legend className="type-label">Modules</legend>
					<div className="flex flex-wrap gap-brand-4">
						{MODULE_KEYS.map((key) => (
							<label key={key} className="flex items-center gap-2 type-caption">
								<input
									type="checkbox"
									checked={modules.includes(key)}
									onChange={(event) =>
										setModules((current) =>
											event.target.checked
												? [...current, key]
												: current.filter((m) => m !== key),
										)
									}
								/>
								{MODULES[key].label}
							</label>
						))}
					</div>
				</fieldset>
				<Button
					type="submit"
					disabled={
						create.isPending ||
						modules.length === 0 ||
						!name.trim() ||
						(kind === "client" && !ownerEmail.trim())
					}
				>
					{create.isPending ? "Creating…" : "Create"}
				</Button>
			</form>

			{create.isError ? (
				<p className="type-caption text-destructive">{create.error.message}</p>
			) : null}
			{create.data?.invite ? (
				<InviteLink
					url={create.data.invite.url}
					emailed={create.data.invite.emailed}
					days={create.data.invite.expiresInDays}
				/>
			) : null}
			{create.data && !create.data.invite ? (
				<p className="type-caption">
					Created.{" "}
					<Link to="/workspace/$orgId" params={{ orgId: create.data.orgId }}>
						Open it
					</Link>
					.
				</p>
			) : null}
		</section>
	);
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
	const refresh = useRefresh();
	const suspended = workspace.status === "suspended";
	const owners = workspace.members.filter((m) => m.role === "owner");

	const status = useMutation({
		mutationFn: (input: { status: "active" | "suspended"; reason?: string }) =>
			setWorkspaceStatus({ data: { orgId: workspace.id, ...input } }),
		onSuccess: refresh,
	});

	return (
		<li className="space-y-brand-4 rounded-lg border bg-card p-brand-6">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="space-y-1">
					<h2 className="type-title">
						{workspace.yours ? (
							<Link to="/workspace/$orgId" params={{ orgId: workspace.id }}>
								{workspace.name}
							</Link>
						) : (
							workspace.name
						)}
					</h2>
					<div className="flex flex-wrap gap-2">
						<Badge tone={suspended ? "bad" : "good"}>{workspace.status}</Badge>
						{workspace.overdue ? (
							<Badge tone="bad">payment overdue</Badge>
						) : null}
						{workspace.yours ? <Badge>yours</Badge> : <Badge>client</Badge>}
						{workspace.plan ? <Badge>{workspace.plan}</Badge> : null}
					</div>
				</div>

				{suspended ? (
					<Button
						size="sm"
						disabled={status.isPending}
						onClick={() => status.mutate({ status: "active" })}
					>
						Reactivate
					</Button>
				) : (
					<Button
						size="sm"
						variant="destructive"
						disabled={status.isPending}
						onClick={() => {
							const reason = window.prompt(
								`Suspend ${workspace.name}? Its people will see this reason (optional):`,
								workspace.overdue ? "Payment is overdue." : "",
							);
							// Cancel returns null; an empty string still suspends.
							if (reason !== null) {
								status.mutate({ status: "suspended", reason });
							}
						}}
					>
						Suspend
					</Button>
				)}
			</div>

			{suspended && workspace.suspendedReason ? (
				<p className="type-caption text-muted-foreground">
					Suspended
					{workspace.suspendedAt
						? ` on ${new Date(workspace.suspendedAt).toLocaleDateString()}`
						: ""}
					: {workspace.suspendedReason}
				</p>
			) : null}

			<dl className="grid gap-x-brand-6 gap-y-1 type-caption sm:grid-cols-4">
				<Stat label="Owner">
					{owners.length > 0
						? owners.map((o) => o.email ?? o.displayName).join(", ")
						: workspace.invites.some((i) => i.role === "owner")
							? "invited, not joined yet"
							: "none"}
				</Stat>
				<Stat label="Seats">
					{workspace.seatsUsed} / {workspace.seatLimit ?? "∞"}
				</Stat>
				<Stat label="Drafts this month">{workspace.draftsThisMonth}</Stat>
				<Stat label="Model cost this month">
					${workspace.modelUsdThisMonth.toFixed(4)}
				</Stat>
				<Stat label="Promos this month">{workspace.promosThisMonth}</Stat>
				<Stat label="Promo credits this month">
					{workspace.promoCreditsThisMonth}
				</Stat>
				<Stat label="Promo media cost">
					${workspace.promoUsdThisMonth.toFixed(4)}
				</Stat>
			</dl>

			<details>
				<summary className="type-caption cursor-pointer">
					Modules ·{" "}
					{workspace.modules
						.filter((m) => m.enabled)
						.map(
							(m) =>
								`${MODULES[m.module].label}${MODULES[m.module].metered ? ` (${m.creditsUsed}/${m.monthlyCredits} credits)` : ""}`,
						)
						.join(", ") || "none"}
				</summary>
				<div className="mt-brand-4 space-y-brand-6">
					{workspace.modules.map((m) => (
						<ModuleForm
							key={m.module}
							orgId={workspace.id}
							value={m}
							onSaved={refresh}
						/>
					))}
				</div>
			</details>

			<details>
				<summary className="type-caption cursor-pointer">
					Billing · {money(workspace.priceMonthly, workspace.currency)}/month ·
					paid until {workspace.paidUntil ?? "—"}
				</summary>
				<BillingForm workspace={workspace} onSaved={refresh} />
			</details>

			<details>
				<summary className="type-caption cursor-pointer">
					Team · {workspace.members.length} people
					{workspace.invites.length > 0
						? ` · ${workspace.invites.length} invited`
						: ""}
					{workspace.teamInvitesEnabled ? "" : " · team invites off"}
				</summary>
				<TeamPanel workspace={workspace} onChanged={refresh} />
			</details>

			{status.isError ? (
				<p className="type-caption text-destructive">{status.error.message}</p>
			) : null}
		</li>
	);
}

function BillingForm({
	workspace,
	onSaved,
}: {
	workspace: Workspace;
	onSaved: () => void;
}) {
	const [plan, setPlan] = useState(workspace.plan ?? "");
	const [price, setPrice] = useState(workspace.priceMonthly ?? "");
	const [currency, setCurrency] = useState(workspace.currency);
	const [paidUntil, setPaidUntil] = useState(workspace.paidUntil ?? "");
	const [note, setNote] = useState(workspace.billingNote ?? "");

	const save = useMutation({
		mutationFn: () =>
			updateBilling({
				data: {
					orgId: workspace.id,
					plan: plan.trim() || null,
					priceMonthly: String(price).trim() ? Number(price) : null,
					currency: currency.trim() || "ETB",
					paidUntil: paidUntil || null,
					billingNote: note.trim() || null,
				},
			}),
		onSuccess: onSaved,
	});

	return (
		<form
			className="mt-brand-4 grid gap-brand-4 sm:grid-cols-2"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<Field id={`plan-${workspace.id}`} label="Plan">
				<Input
					id={`plan-${workspace.id}`}
					value={plan}
					placeholder="Starter"
					onChange={(event) => setPlan(event.target.value)}
				/>
			</Field>
			<div className="flex gap-2">
				<Field id={`price-${workspace.id}`} label="Price per month">
					<Input
						id={`price-${workspace.id}`}
						type="number"
						min={0}
						step="0.01"
						value={price}
						onChange={(event) => setPrice(event.target.value)}
					/>
				</Field>
				<Field id={`currency-${workspace.id}`} label="Currency">
					<Input
						id={`currency-${workspace.id}`}
						className="w-20"
						maxLength={3}
						value={currency}
						onChange={(event) => setCurrency(event.target.value)}
					/>
				</Field>
			</div>
			<Field id={`paid-${workspace.id}`} label="Paid until">
				<Input
					id={`paid-${workspace.id}`}
					type="date"
					value={paidUntil}
					onChange={(event) => setPaidUntil(event.target.value)}
				/>
			</Field>
			<Field id={`note-${workspace.id}`} label="Note">
				<Input
					id={`note-${workspace.id}`}
					value={note}
					placeholder="Paid by Telebirr, ref …"
					onChange={(event) => setNote(event.target.value)}
				/>
			</Field>
			<div className="flex items-center gap-brand-4 sm:col-span-2">
				<Button type="submit" size="sm" disabled={save.isPending}>
					{save.isPending ? "Saving…" : "Save billing"}
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
		</form>
	);
}

function ModuleForm({
	orgId,
	value,
	onSaved,
}: {
	orgId: string;
	value: WorkspaceModule;
	onSaved: () => void;
}) {
	const spec = MODULES[value.module];
	const id = `${value.module}-${orgId}`;
	const [enabled, setEnabled] = useState(
		value.subscribed ? value.enabled : true,
	);
	const [paidUntil, setPaidUntil] = useState(value.paidUntil ?? "");
	const [credits, setCredits] = useState(String(value.monthlyCredits));
	const [price, setPrice] = useState(value.priceMonthly ?? "");
	const [currency, setCurrency] = useState(value.currency);
	const [note, setNote] = useState(value.note ?? "");
	const [topUp, setTopUp] = useState("");

	const save = useMutation({
		mutationFn: () =>
			updateModule({
				data: {
					orgId,
					module: value.module,
					enabled,
					paidUntil: paidUntil || null,
					monthlyCredits: Number(credits) || 0,
					priceMonthly: String(price).trim() ? Number(price) : null,
					currency: currency.trim() || "ETB",
					note: note.trim() || null,
				},
			}),
		onSuccess: onSaved,
	});

	const adjust = useMutation({
		mutationFn: () =>
			adjustModuleCredits({
				data: { orgId, module: value.module, delta: Number(topUp) },
			}),
		onSuccess: () => {
			setTopUp("");
			onSaved();
		},
	});

	return (
		<form
			className="grid gap-brand-4 rounded-md border p-brand-4 sm:grid-cols-2"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<div className="flex items-center justify-between gap-2 sm:col-span-2">
				<h3 className="type-label">
					{spec.label}
					{value.subscribed ? "" : " · not subscribed"}
				</h3>
				<label
					htmlFor={`on-${id}`}
					className="flex items-center gap-2 type-caption"
				>
					<Switch
						id={`on-${id}`}
						checked={enabled}
						onCheckedChange={setEnabled}
					/>
					{enabled ? "On" : "Off"}
				</label>
			</div>
			<Field id={`paid-${id}`} label="Paid until">
				<Input
					id={`paid-${id}`}
					type="date"
					value={paidUntil}
					onChange={(event) => setPaidUntil(event.target.value)}
				/>
			</Field>
			<div className="flex gap-2">
				<Field id={`price-${id}`} label="Price per month">
					<Input
						id={`price-${id}`}
						type="number"
						min={0}
						step="0.01"
						value={price}
						onChange={(event) => setPrice(event.target.value)}
					/>
				</Field>
				<Field id={`currency-${id}`} label="Currency">
					<Input
						id={`currency-${id}`}
						className="w-20"
						maxLength={3}
						value={currency}
						onChange={(event) => setCurrency(event.target.value)}
					/>
				</Field>
			</div>
			{spec.metered ? (
				<Field id={`credits-${id}`} label="Credits per month">
					<Input
						id={`credits-${id}`}
						type="number"
						min={0}
						value={credits}
						onChange={(event) => setCredits(event.target.value)}
					/>
				</Field>
			) : null}
			<Field id={`note-${id}`} label="Note">
				<Input
					id={`note-${id}`}
					value={note}
					onChange={(event) => setNote(event.target.value)}
				/>
			</Field>
			<div className="flex flex-wrap items-center gap-brand-4 sm:col-span-2">
				<Button type="submit" size="sm" disabled={save.isPending}>
					{save.isPending
						? "Saving…"
						: value.subscribed
							? "Save"
							: `Add ${spec.label}`}
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
			{spec.metered && value.subscribed ? (
				<div className="flex flex-wrap items-end gap-2 sm:col-span-2">
					<Field
						id={`topup-${id}`}
						label="Top up this month (negative to remove)"
					>
						<Input
							id={`topup-${id}`}
							type="number"
							className="w-32"
							value={topUp}
							onChange={(event) => setTopUp(event.target.value)}
						/>
					</Field>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={adjust.isPending || !Number(topUp)}
						onClick={() => adjust.mutate()}
					>
						Apply
					</Button>
					<span className="type-caption text-muted-foreground">
						{value.creditsUsed} of {value.monthlyCredits} used this month
					</span>
					{adjust.isError ? (
						<span className="type-caption text-destructive">
							{adjust.error.message}
						</span>
					) : null}
				</div>
			) : null}
		</form>
	);
}

function TeamPanel({
	workspace,
	onChanged,
}: {
	workspace: Workspace;
	onChanged: () => void;
}) {
	const [seats, setSeats] = useState(
		workspace.seatLimit === null ? "" : String(workspace.seatLimit),
	);
	const [invitesOn, setInvitesOn] = useState(workspace.teamInvitesEnabled);
	const [ownerEmail, setOwnerEmail] = useState("");

	const limits = useMutation({
		mutationFn: () =>
			updateTeamLimits({
				data: {
					orgId: workspace.id,
					seatLimit: seats.trim() ? Number(seats) : null,
					teamInvitesEnabled: invitesOn,
				},
			}),
		onSuccess: onChanged,
	});

	const invite = useMutation({
		mutationFn: () =>
			inviteOwner({ data: { orgId: workspace.id, email: ownerEmail.trim() } }),
		onSuccess: () => {
			setOwnerEmail("");
			onChanged();
		},
	});

	const withdraw = useMutation({
		mutationFn: (inviteId: string) =>
			adminWithdrawInvite({ data: { orgId: workspace.id, inviteId } }),
		onSuccess: onChanged,
	});

	return (
		<div className="mt-brand-4 space-y-brand-4">
			<ul className="space-y-1">
				{workspace.members.map((member) => (
					<li key={member.id} className="type-caption">
						{member.displayName} · {member.role}
						{member.email ? ` · ${member.email}` : ""}
						{member.onTelegram ? " · on Telegram" : ""}
					</li>
				))}
				{workspace.invites.map((pending) => (
					<li
						key={pending.id}
						className="flex flex-wrap items-center gap-2 type-caption text-muted-foreground"
					>
						Invited {pending.email} as {pending.role}, until{" "}
						{new Date(pending.expiresAt).toLocaleDateString()}
						<Button
							variant="ghost"
							size="xs"
							disabled={withdraw.isPending}
							onClick={() => withdraw.mutate(pending.id)}
						>
							Withdraw
						</Button>
					</li>
				))}
			</ul>

			<form
				className="flex flex-wrap items-end gap-brand-4"
				onSubmit={(event) => {
					event.preventDefault();
					limits.mutate();
				}}
			>
				<Field id={`seats-${workspace.id}`} label="Seat limit">
					<Input
						id={`seats-${workspace.id}`}
						className="w-28"
						type="number"
						min={1}
						max={500}
						value={seats}
						placeholder="No limit"
						onChange={(event) => setSeats(event.target.value)}
					/>
				</Field>
				<label
					htmlFor={`invites-${workspace.id}`}
					className="flex items-center gap-2 type-caption"
				>
					<Switch
						id={`invites-${workspace.id}`}
						checked={invitesOn}
						onCheckedChange={setInvitesOn}
					/>
					Owners may invite their team
				</label>
				<Button type="submit" size="sm" disabled={limits.isPending}>
					{limits.isPending ? "Saving…" : "Save team limits"}
				</Button>
				{limits.isError ? (
					<span className="type-caption text-destructive">
						{limits.error.message}
					</span>
				) : null}
			</form>

			<form
				className="flex flex-wrap items-end gap-brand-4"
				onSubmit={(event) => {
					event.preventDefault();
					invite.mutate();
				}}
			>
				<Field id={`owner-${workspace.id}`} label="Invite an owner">
					<Input
						id={`owner-${workspace.id}`}
						type="email"
						required
						value={ownerEmail}
						placeholder="owner@client.com"
						onChange={(event) => setOwnerEmail(event.target.value)}
					/>
				</Field>
				<Button
					type="submit"
					size="sm"
					variant="secondary"
					disabled={invite.isPending || !ownerEmail.trim()}
				>
					{invite.isPending ? "Creating…" : "Create owner invite"}
				</Button>
			</form>
			{invite.isError ? (
				<p className="type-caption text-destructive">{invite.error.message}</p>
			) : null}
			{invite.data ? (
				<InviteLink
					url={invite.data.url}
					emailed={invite.data.emailed}
					days={invite.data.expiresInDays}
				/>
			) : null}
		</div>
	);
}

function Field({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			{children}
		</div>
	);
}

function Stat({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<dt className="text-muted-foreground">{label}</dt>
			<dd>{children}</dd>
		</div>
	);
}

function Badge({
	children,
	tone,
}: {
	children: React.ReactNode;
	tone?: "good" | "bad";
}) {
	const colour =
		tone === "bad"
			? "border-destructive/40 text-destructive"
			: tone === "good"
				? "border-primary/40 text-primary"
				: "text-muted-foreground";
	return (
		<span className={`rounded-full border px-2 py-0.5 type-label ${colour}`}>
			{children}
		</span>
	);
}
