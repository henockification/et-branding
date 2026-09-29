import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { AuthCard, FieldError } from "#/components/auth-card";
import { Button } from "#/components/ui/button";
import { signOut } from "#/lib/auth-client";
import { acceptInvite, fetchInvite } from "#/server/web-invites";

/**
 * Where an invite link lands.
 *
 * Public, because the person opening it usually has no account yet. From here
 * they sign up (the form is pre-filled and the server only lets the invited
 * address in), sign in, or — once signed in — join with one click.
 */
export const Route = createFileRoute("/invite/$token")({
	loader: ({ params }) => fetchInvite({ data: { token: params.token } }),
	component: InvitePage,
});

const CLOSED: Record<string, { title: string; body: string }> = {
	expired: {
		title: "This invite has expired",
		body: "Invites are good for a week. Ask for a new one.",
	},
	revoked: {
		title: "This invite was withdrawn",
		body: "A newer invite may have replaced it. Ask for a new one.",
	},
	suspended: {
		title: "This workspace is paused",
		body: "It is suspended at the moment, so nobody can join. Try again once it is reopened.",
	},
	invalid: {
		title: "This link does not work",
		body: "Check that the whole link was copied, or ask for a new one.",
	},
};

function InvitePage() {
	const { token } = Route.useParams();
	const invite = Route.useLoaderData();
	const router = useRouter();
	const here = `/invite/${token}`;

	const join = useMutation({
		mutationFn: () => acceptInvite({ data: { token } }),
		onSuccess: ({ orgId }) =>
			router.navigate({ href: `/workspace/${orgId}`, reloadDocument: true }),
	});

	if (invite.status === "accepted") {
		return (
			<AuthCard
				title="Invite already used"
				subtitle="This link has done its job."
				footer={<Link to="/dashboard">Go to your workspaces</Link>}
			>
				<p className="type-body text-muted-foreground">
					If that was you, sign in and your workspace is waiting.
				</p>
			</AuthCard>
		);
	}

	const closed = CLOSED[invite.status];
	if (closed || !invite.email) {
		return (
			<AuthCard
				title={closed?.title ?? CLOSED.invalid.title}
				subtitle={closed?.body ?? CLOSED.invalid.body}
				footer={<Link to="/sign-in">Sign in</Link>}
			>
				<span />
			</AuthCard>
		);
	}

	const title = `Join ${invite.orgName}`;
	const subtitle = `You have been invited as ${invite.role}, to review drafts and teach the Brand Brain your voice.`;

	if (!invite.signedInAs) {
		return (
			<AuthCard
				title={title}
				subtitle={subtitle}
				footer={
					<>
						Already have an account with {invite.email}?{" "}
						<Link to="/sign-in" search={{ redirect: here }}>
							Sign in
						</Link>
						.
					</>
				}
			>
				<p className="type-body">
					The invite is for <b>{invite.email}</b>. Create your account with that
					address.
				</p>
				<Button asChild className="w-full">
					<Link to="/sign-up" search={{ invite: token, email: invite.email }}>
						Create my account
					</Link>
				</Button>
			</AuthCard>
		);
	}

	const matches =
		invite.signedInAs.toLowerCase() === invite.email.toLowerCase();

	return (
		<AuthCard
			title={title}
			subtitle={subtitle}
			footer={<>Signed in as {invite.signedInAs}.</>}
		>
			{matches ? (
				<>
					<Button
						className="w-full"
						disabled={join.isPending}
						onClick={() => join.mutate()}
					>
						{join.isPending ? "Joining…" : `Join ${invite.orgName}`}
					</Button>
					<FieldError message={join.error?.message ?? null} />
				</>
			) : (
				<>
					<p className="type-body">
						This invite is for <b>{invite.email}</b>, but you are signed in as{" "}
						{invite.signedInAs}.
					</p>
					<Button
						variant="secondary"
						className="w-full"
						onClick={async () => {
							await signOut();
							router.navigate({ href: here, reloadDocument: true });
						}}
					>
						Sign out and continue
					</Button>
				</>
			)}
		</AuthCard>
	);
}
