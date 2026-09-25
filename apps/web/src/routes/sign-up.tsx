import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AuthCard, FieldError } from "#/components/auth-card";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { signIn, signUp } from "#/lib/auth-client";
import { fetchAuthProviders } from "#/server/session";

/** Matches `minPasswordLength` in the Better Auth config. */
const MIN_PASSWORD_LENGTH = 12;

export const Route = createFileRoute("/sign-up")({
	loader: () => fetchAuthProviders(),
	component: SignUp,
});

function SignUp() {
	const providers = Route.useLoaderData();
	const router = useRouter();

	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
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

		router.navigate({ href: "/dashboard", reloadDocument: true });
	}

	return (
		<AuthCard
			title="Start a brand"
			subtitle="Create an account and put the agent team to work."
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
							signIn.social({ provider: "google", callbackURL: "/dashboard" })
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
