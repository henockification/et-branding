import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { signOut, useSession } from "#/lib/auth-client";

/**
 * Sign-in link or sign-out button, depending on the session.
 *
 * Renders nothing while the session is still loading so the header does not
 * flip from "Sign in" to the user's name on every page load.
 */
export function UserMenu() {
	const { data: session, isPending } = useSession();
	const router = useRouter();

	if (isPending) {
		return <span className="h-9 w-20" aria-hidden="true" />;
	}

	if (!session) {
		return (
			<Button asChild size="sm">
				<Link to="/sign-in">Sign in</Link>
			</Button>
		);
	}

	return (
		<div className="flex items-center gap-brand-4">
			<Link to="/dashboard" className="type-caption no-underline">
				{session.user.name || session.user.email}
			</Link>
			<Button
				variant="ghost"
				size="sm"
				onClick={async () => {
					await signOut();
					// Full reload so server loaders re-run without the session cookie.
					router.navigate({ href: "/", reloadDocument: true });
				}}
			>
				Sign out
			</Button>
		</div>
	);
}
