import { BRANDING, LOGO } from "@et/core";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { AppFooter } from "#/components/app-footer";
import { AppHeader } from "#/components/app-header";
import { Button } from "#/components/ui/button";
import { THEME_INIT_SCRIPT } from "#/lib/theme";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: BRANDING.name,
			},
			{
				name: "description",
				content: BRANDING.description,
			},
			{
				name: "theme-color",
				content: BRANDING.themeColor,
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: LOGO.appIcon,
			},
		],
	}),
	component: RootLayout,
	notFoundComponent: NotFound,
	errorComponent: ErrorPage,
	shellComponent: RootDocument,
});

/** The chrome every route renders inside. */
function RootLayout() {
	return (
		<div className="flex min-h-dvh flex-col">
			<AppHeader />
			<div className="flex-1">
				<Outlet />
			</div>
			<AppFooter />
		</div>
	);
}

function NotFound() {
	return (
		<CenteredMessage
			kicker="404"
			title="Nothing here yet"
			body="The link may be out of date, or this page has not been built yet."
		/>
	);
}

function ErrorPage({ error }: ErrorComponentProps) {
	return (
		<CenteredMessage
			kicker="Error"
			title="Something went wrong"
			body={error instanceof Error ? error.message : "Unknown error."}
		/>
	);
}

function CenteredMessage({
	kicker,
	title,
	body,
}: {
	kicker: string;
	title: string;
	body: string;
}) {
	return (
		<main className="page-wrap flex flex-col items-center justify-center gap-brand-4 py-brand-12 text-center">
			<p className="type-label text-brand">{kicker}</p>
			<h1 className="type-display-l">{title}</h1>
			<p className="type-body max-w-prose text-muted-foreground">{body}</p>
			<Button asChild className="mt-2">
				<Link to="/">Back to home</Link>
			</Button>
		</main>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Must run before paint — see THEME_INIT_SCRIPT for why. */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static build-time constant, no user input */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body>
				{children}
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
						TanStackQueryDevtools,
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
