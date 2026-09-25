import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { AuthCard, FieldError } from "#/components/auth-card";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";

/** Matches `minPasswordLength` in the Better Auth config. */
const MIN_PASSWORD_LENGTH = 12;

const searchSchema = z.object({
	/** Attached by Better Auth's callback after it validates the emailed token. */
	token: z.string().optional(),
	/** Present instead of `token` when the link was expired or already used. */
	error: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
	validateSearch: searchSchema,
	component: ResetPassword,
});

function ResetPassword() {
	const { token, error: linkError } = Route.useSearch();
	const router = useRouter();

	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	// A link that is expired, already used, or hand-typed never reaches the form.
	if (!token || linkError) {
		return (
			<AuthCard
				title="That link has expired"
				subtitle="Reset links are good for one hour and can only be used once."
				footer={<Link to="/sign-in">Back to sign in</Link>}
			>
				<Button asChild className="w-full">
					<Link to="/forgot-password">Send a new link</Link>
				</Button>
			</AuthCard>
		);
	}

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);

		if (password.length < MIN_PASSWORD_LENGTH) {
			setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
			return;
		}

		if (password !== confirm) {
			setError("Those two passwords do not match.");
			return;
		}

		setPending(true);
		const { error: resetError } = await authClient.resetPassword({
			newPassword: password,
			token,
		});
		setPending(false);

		if (resetError) {
			setError("That link is no longer valid. Request a new one.");
			return;
		}

		// Better Auth revokes other sessions on reset, so sign in fresh.
		router.navigate({ href: "/sign-in", reloadDocument: true });
	}

	return (
		<AuthCard
			title="Choose a new password"
			subtitle="Pick something you have not used here before."
			footer={<Link to="/sign-in">Back to sign in</Link>}
		>
			<form onSubmit={onSubmit} className="space-y-brand-4">
				<div className="space-y-2">
					<Label htmlFor="password">New password</Label>
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

				<div className="space-y-2">
					<Label htmlFor="confirm">Confirm password</Label>
					<Input
						id="confirm"
						type="password"
						autoComplete="new-password"
						required
						value={confirm}
						onChange={(event) => setConfirm(event.target.value)}
					/>
				</div>

				<FieldError message={error} />

				<Button type="submit" className="w-full" disabled={pending}>
					{pending ? "Saving…" : "Save new password"}
				</Button>
			</form>
		</AuthCard>
	);
}
