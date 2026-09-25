import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { AuthCard, FieldError } from "#/components/auth-card";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { signIn } from "#/lib/auth-client";
import { fetchAuthProviders } from "#/server/session";

const searchSchema = z.object({
	/** Where to land after signing in. Defaults to the dashboard. */
	redirect: z.string().optional(),
});

export const Route = createFileRoute("/sign-in")({
	validateSearch: searchSchema,
	loader: () => fetchAuthProviders(),
	component: SignIn,
});

function SignIn() {
	const providers = Route.useLoaderData();
	const search = Route.useSearch();
	const router = useRouter();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const destination = search.redirect ?? "/dashboard";

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setPending(true);

		const { error: signInError } = await signIn.email({ email, password });

		setPending(false);

		if (signInError) {
			// Deliberately vague: saying which half was wrong tells an attacker
			// whether an address has an account here.
			setError("That email and password do not match an account.");
			return;
		}

		// A full navigation so every loader re-runs with the new session cookie.
		router.navigate({ href: destination, reloadDocument: true });
	}

	return (
		<AuthCard
			title="Welcome back"
			subtitle="Sign in to pick up where your brand left off."
			footer={
				<>
					New here? <Link to="/sign-up">Create an account</Link>.
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
					<Divider />
				</>
			) : null}

			<form onSubmit={onSubmit} className="space-y-brand-4">
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
						autoComplete="current-password"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</div>

				<FieldError message={error} />

				<Button type="submit" className="w-full" disabled={pending}>
					{pending ? "Signing in…" : "Sign in"}
				</Button>
			</form>
		</AuthCard>
	);
}

export function Divider() {
	return (
		<div className="flex items-center gap-brand-4">
			<span className="h-px flex-1 bg-border" />
			<span className="type-caption text-muted-foreground">or</span>
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}
