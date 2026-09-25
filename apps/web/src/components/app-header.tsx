import { BRANDING } from "@et/core";
import { Link } from "@tanstack/react-router";
import { BrandLockup } from "#/components/brand-mark";
import { ThemeToggle } from "#/components/theme-toggle";
import { UserMenu } from "#/components/user-menu";

/**
 * Add routes here as they land; the header renders whatever is in this list.
 */
const NAV_LINKS = [{ to: "/", label: "Home" }] as const;

export function AppHeader() {
	return (
		<header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
			<div className="page-wrap flex h-16 items-center gap-brand-6">
				<Link
					to="/"
					className="no-underline"
					aria-label={`${BRANDING.name} home`}
				>
					<BrandLockup size={28} />
				</Link>

				<nav
					className="flex items-center gap-brand-4 type-caption"
					aria-label="Main"
				>
					{NAV_LINKS.map((link) => (
						<Link
							key={link.to}
							to={link.to}
							className="text-muted-foreground no-underline transition-colors hover:text-foreground"
							activeProps={{ className: "text-foreground" }}
							activeOptions={{ exact: link.to === "/" }}
						>
							{link.label}
						</Link>
					))}
				</nav>

				<div className="ml-auto flex items-center gap-2">
					<ThemeToggle />
					<UserMenu />
				</div>
			</div>
		</header>
	);
}
