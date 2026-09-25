import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthCard, FieldError } from "#/components/auth-card";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/forgot-password")({
	component: ForgotPassword,
});

function ForgotPassword() {
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setPending(true);

		const { error: requestError } = await authClient.requestPasswordReset({
			email,
			// Where the link in the email lands. Better Auth verifies the token at
			// its own callback first, then redirects here with it attached.
			redirectTo: "/reset-password",
		});

		setPending(false);

		if (requestError) {
			setError("Something went wrong. Try again in a moment.");
			return;
		}

		setSent(true);
	}

	if (sent) {
		return (
			<AuthCard
				title="Check your email"
				subtitle="If that address has an account, a reset link is on its way. It is good for one hour."
				footer={<Link to="/sign-in">Back to sign in</Link>}
			>
				<p className="type-body text-muted-foreground">
					Nothing arrived? Check spam, or{" "}
					<button
						type="button"
						className="text-primary underline"
						onClick={() => setSent(false)}
					>
						try another address
					</button>
					.
				</p>
			</AuthCard>
		);
	}

	return (
		<AuthCard
			title="Forgot your password?"
			subtitle="Give us the address on the account and we'll send a reset link."
			footer={
				<>
					Remembered it? <Link to="/sign-in">Sign in</Link>.
				</>
			}
		>
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

				<FieldError message={error} />

				<Button type="submit" className="w-full" disabled={pending}>
					{pending ? "Sending…" : "Send reset link"}
				</Button>
			</form>
		</AuthCard>
	);
}
