import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	createWebInvite,
	fetchPeople,
	removeMember,
	revokeInvite,
	setMemberRole,
} from "#/server/web-invites";

type Role = "owner" | "approver" | "member";

const ROLE_HINTS: Record<Role, string> = {
	owner: "Edits the brand and past posts, decides on drafts.",
	approver: "Same as owner, for the people who sign off posts.",
	member: "Can look, cannot change anything.",
};

/**
 * Who is in a workspace, and — for its owners — the controls: invite a
 * teammate, change a role, remove someone, withdraw an invite. How many seats
 * there are, and whether invites are allowed at all, is set by the platform
 * admin.
 */
export function People({ orgId }: { orgId: string }) {
	const queryClient = useQueryClient();
	const queryKey = ["people", orgId];
	const people = useQuery({
		queryKey,
		queryFn: () => fetchPeople({ data: { orgId } }),
	});
	const refresh = () => queryClient.invalidateQueries({ queryKey });

	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("owner");

	const invite = useMutation({
		mutationFn: () =>
			createWebInvite({ data: { orgId, email: email.trim(), role } }),
		onSuccess: () => {
			setEmail("");
			refresh();
		},
	});

	const revoke = useMutation({
		mutationFn: (inviteId: string) =>
			revokeInvite({ data: { orgId, inviteId } }),
		onSuccess: refresh,
	});

	const changeRole = useMutation({
		mutationFn: (input: { memberId: string; role: Role }) =>
			setMemberRole({ data: { orgId, ...input } }),
		onSuccess: refresh,
	});

	const remove = useMutation({
		mutationFn: (memberId: string) =>
			removeMember({ data: { orgId, memberId } }),
		onSuccess: refresh,
	});

	if (!people.data?.found) return null;
	const { canManage, myMemberId, members, invites, seats } = people.data;
	const full = seats.limit !== null && seats.used >= seats.limit;
	const canInvite = canManage && seats.teamInvitesEnabled && !full;

	return (
		<section id="people" className="space-y-brand-6">
			<header className="space-y-2">
				<h2 className="type-title">People</h2>
				<p className="type-caption text-muted-foreground">
					One list for the web and Telegram. Removing someone here takes away
					both.{" "}
					{seats.limit !== null
						? `${seats.used} of ${seats.limit} seats used, counting open invites.`
						: null}
				</p>
			</header>

			<ul className="divide-y rounded-lg border">
				{members.map((member) => (
					<li
						key={member.id}
						className="flex flex-wrap items-center justify-between gap-2 p-brand-4"
					>
						<div>
							<p className="type-body">{member.displayName}</p>
							<p className="type-caption text-muted-foreground">
								{[member.email, member.onTelegram ? "on Telegram" : null]
									.filter(Boolean)
									.join(" · ") || "—"}
							</p>
						</div>

						{canManage ? (
							<div className="flex items-center gap-2">
								<Select
									value={member.role}
									onValueChange={(value) =>
										changeRole.mutate({
											memberId: member.id,
											role: value as Role,
										})
									}
								>
									<SelectTrigger size="sm" aria-label="Role">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="owner">owner</SelectItem>
										<SelectItem value="approver">approver</SelectItem>
										<SelectItem value="member">member</SelectItem>
									</SelectContent>
								</Select>
								{member.id === myMemberId ? (
									<span className="type-caption text-muted-foreground">
										you
									</span>
								) : (
									<Button
										variant="ghost"
										size="sm"
										disabled={remove.isPending}
										onClick={() => {
											if (
												window.confirm(
													`Remove ${member.displayName} from this workspace?`,
												)
											) {
												remove.mutate(member.id);
											}
										}}
									>
										Remove
									</Button>
								)}
							</div>
						) : (
							<span className="type-label text-muted-foreground">
								{member.role}
							</span>
						)}
					</li>
				))}
			</ul>

			{changeRole.error || remove.error ? (
				<p className="type-caption text-destructive">
					{(changeRole.error ?? remove.error)?.message}
				</p>
			) : null}

			{canManage && !canInvite ? (
				<p className="type-caption text-muted-foreground">
					{seats.teamInvitesEnabled
						? `All ${seats.limit} seats are in use. Remove someone or withdraw an invite to add another person, or ask your account manager for more seats.`
						: "Team invites are turned off for this workspace. Contact your account manager to add people."}
				</p>
			) : null}

			{canInvite ? (
				<div className="space-y-brand-4 rounded-lg border bg-card p-brand-6">
					<h3 className="type-body font-medium">Invite a teammate</h3>

					<form
						className="flex flex-wrap items-end gap-brand-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (email.trim()) invite.mutate();
						}}
					>
						<div className="min-w-56 flex-1 space-y-2">
							<Label htmlFor="invite-email">Their email</Label>
							<Input
								id="invite-email"
								type="email"
								required
								value={email}
								placeholder="teammate@company.com"
								onChange={(event) => setEmail(event.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="invite-role">Role</Label>
							<Select
								value={role}
								onValueChange={(value) => setRole(value as Role)}
							>
								<SelectTrigger id="invite-role">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="owner">owner</SelectItem>
									<SelectItem value="approver">approver</SelectItem>
									<SelectItem value="member">member</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<Button type="submit" disabled={invite.isPending || !email.trim()}>
							{invite.isPending ? "Creating…" : "Create invite"}
						</Button>
					</form>
					<p className="type-caption text-muted-foreground">
						{ROLE_HINTS[role]}
					</p>

					{invite.isError ? (
						<p className="type-caption text-destructive">
							{invite.error.message}
						</p>
					) : null}
				</div>
			) : null}

			{/* Outside the form: the last invite may fill the last seat and hide it. */}
			{invite.data ? (
				<InviteLink
					url={invite.data.url}
					emailed={invite.data.emailed}
					days={invite.data.expiresInDays}
				/>
			) : null}

			{canManage && invites.length > 0 ? (
				<div className="space-y-2">
					<p className="type-caption text-muted-foreground">
						Waiting to be accepted
					</p>
					<ul className="space-y-1">
						{invites.map((pending) => (
							<li
								key={pending.id}
								className="flex flex-wrap items-center justify-between gap-2"
							>
								<span className="type-caption">
									{pending.email} · {pending.role} · until{" "}
									{new Date(pending.expiresAt).toLocaleDateString()}
								</span>
								<Button
									variant="ghost"
									size="xs"
									disabled={revoke.isPending}
									onClick={() => revoke.mutate(pending.id)}
								>
									Withdraw
								</Button>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}

/**
 * The link is shown once — only its hash is stored — so it is made easy to
 * copy on the spot.
 */
export function InviteLink({
	url,
	emailed,
	days,
}: {
	url: string;
	emailed: boolean;
	days: number;
}) {
	const [copied, setCopied] = useState(false);

	return (
		<div className="space-y-2 rounded-md border border-dashed p-brand-4">
			<p className="type-caption">
				{emailed
					? "Emailed to them. You can also send this link yourself:"
					: "Send them this link — on Telegram, WhatsApp, anywhere:"}
			</p>
			<code className="block break-all text-xs">{url}</code>
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					variant="secondary"
					onClick={async () => {
						await navigator.clipboard.writeText(url);
						setCopied(true);
					}}
				>
					{copied ? "Copied" : "Copy link"}
				</Button>
				<span className="type-caption text-muted-foreground">
					Works once, for {days} days. It is not shown again.
				</span>
			</div>
		</div>
	);
}
