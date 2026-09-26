import { pruneHandledUpdates } from "#/server/telegram/refine";
import { organizationsToPlan, runWeeklyPlan } from "#/server/telegram/weekly";

/**
 * The Monday job.
 *
 * Organizations are planned one at a time rather than in parallel: the model
 * provider rate-limits per key, and a weekly job has no deadline worth racing
 * for. Each result is logged, because a cron failure is otherwise invisible —
 * nobody is watching when it runs.
 */
export async function runScheduledPlans(scheduledFor: Date): Promise<void> {
	// Telegram stops retrying long before a week is out, so handled ids older
	// than that are dead weight. Pruned here rather than on its own schedule.
	await pruneHandledUpdates().catch((error) => {
		console.error("weekly plan: pruning handled updates failed", error);
	});

	const organizations = await organizationsToPlan();

	console.log(
		`weekly plan: starting for ${organizations.length} organization(s) at ${scheduledFor.toISOString()}`,
	);

	for (const org of organizations) {
		try {
			const outcome = await runWeeklyPlan({ orgId: org.id, now: scheduledFor });
			console.log(
				outcome.status === "sent"
					? `weekly plan: ${org.name} — sent ${outcome.posts} posts ($${outcome.usd.toFixed(6)})`
					: `weekly plan: ${org.name} — skipped (${outcome.reason})`,
			);
		} catch (error) {
			// One organization's failure must not stop the rest of the tenants.
			console.error(`weekly plan: ${org.name} — threw`, error);
		}
	}
}
