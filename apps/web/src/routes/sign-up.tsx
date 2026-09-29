import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { AuthCard, FieldError } from "#/components/auth-card";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { signIn, signUp } from "#/lib/auth-client";
import { fetchAuthProviders } from "#/server/session";

/** Matches `minPasswordLength` in the Better Auth config. */
const MIN_PASSWORD_LENGTH = 12;

const searchSchema = z.object({
	/** An invite token: after sign-up, the person lands back on the invite. */
	invite: z.string().optional(),
	/** The invited address, pre-filled. The server enforces it either way. */
	email: z.string().optional(),
});

export const Route = createFileRoute("/sign-up")({
	validateSearch: searchSchema,
	loader: () => fetchAuthProviders(),
	component: SignUp,
});

function SignUp() {
	const providers = Route.useLoaderData();
	const search = Route.useSearch();
	const router = useRouter();

	// Accounts are by invitation; an invite brings the person back to accept it.
	const destination = search.invite ? `/invite/${search.invite}` : "/dashboard";

	const [name, setName] = useState("");
	const [email, setEmail] = useState(search.email ?? "");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);

		if (password.length < MIN_PASSWORD_LENGTH) {
			setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
			return;
		}

		setPending(true);
		const { error: signUpError } = await signUp.email({
			name,
			email,
			password,
		});
		setPending(false);

		if (signUpError) {
			setError(signUpError.message ?? "Could not create that account.");
			return;
		}

		router.navigate({ href: destination, reloadDocument: true });
	}

	return (
		<AuthCard
			title={
				search.invite ? "Create your account" : "Accounts are by invitation"
			}
			subtitle={
				search.invite
					? "Then you are straight into your workspace."
					: "Open the invite link you were sent to create your account. Already have one? Sign in."
			}
			footer={
				<>
					Already have an account? <Link to="/sign-in">Sign in</Link>.
				</>
			}
		>
			{providers.google ? (
				<>
					<Button
						variant="secondary"
						className="w-full"
						onClick={() =>
							signIn.social({ provider: "google", callbackURL: destination })
						}
					>
						Continue with Google
					</Button>
					<div className="flex items-center gap-brand-4">
						<span className="h-px flex-1 bg-border" />
						<span className="type-caption text-muted-foreground">or</span>
						<span className="h-px flex-1 bg-border" />
					</div>
				</>
			) : null}

			<form onSubmit={onSubmit} className="space-y-brand-4">
				<div className="space-y-2">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						autoComplete="name"
						required
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						type="email"
						autoComplete="email"
						required
						// The invite is for one address; changing it would only fail.
						readOnly={Boolean(search.invite && search.email)}
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="password">Password</Label>
					<Input
						id="password"
						type="password"
						autoComplete="new-password"
						required
						minLength={MIN_PASSWORD_LENGTH}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
					<p className="type-caption text-muted-foreground">
						At least {MIN_PASSWORD_LENGTH} characters.
					</p>
				</div>

				<FieldError message={error} />

				<Button type="submit" className="w-full" disabled={pending}>
					{pending ? "Creating account…" : "Create account"}
				</Button>
			</form>
		</AuthCard>
	);
}
