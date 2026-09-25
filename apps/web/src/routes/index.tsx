import { BRANDING } from "@et/core";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

/**
 * The four things the agent team does. Straight from the brand book: strategy,
 * content, design and distribution, working together.
 */
const AGENT_ROLES = [
	{
		name: "Strategy",
		body: "Works out who you're for, what you stand for, and how you sound before a word ships.",
	},
	{
		name: "Content",
		body: "Writes the posts, captions and campaigns — in your voice, on a schedule that holds.",
	},
	{
		name: "Design",
		body: "Turns the identity into everything you post, from a story frame to a launch page.",
	},
	{
		name: "Distribution",
		body: "Puts it where your audience already is, and reports what actually moved.",
	},
] as const;

function Home() {
	return (
		<main>
			<section className="page-wrap py-brand-12">
				<div className="rise-in max-w-3xl space-y-brand-6">
					{/* The one spark moment on this screen. Lime carries ink, never white. */}
					<span className="spark-badge">In build</span>

					<h1 className="type-display-xl">{BRANDING.tagline}</h1>

					<p className="type-body max-w-prose text-muted-foreground">
						{BRANDING.description}
					</p>
				</div>
			</section>

			<section className="page-wrap pb-brand-12">
				<h2 className="type-label mb-brand-6 text-brand">The team</h2>

				<div className="grid gap-brand-4 sm:grid-cols-2">
					{AGENT_ROLES.map((role) => (
						<article
							key={role.name}
							className="rounded-lg border bg-card p-brand-6"
						>
							<h3 className="type-heading mb-2">{role.name}</h3>
							<p className="type-body text-muted-foreground">{role.body}</p>
						</article>
					))}
				</div>
			</section>
		</main>
	);
}
