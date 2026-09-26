import { bigint, pgTable, timestamp } from "drizzle-orm/pg-core";

/**
 * Updates already handled, so a redelivery is a no-op.
 *
 * Telegram redelivers an update it considers undelivered, and does not document
 * the timeout or retry rules — so correctness cannot depend on answering
 * quickly. Every update carries a monotonic `update_id`; inserting it first and
 * skipping on conflict makes handling idempotent whatever the transport does.
 *
 * Rows are disposable: anything older than a day can be deleted, since Telegram
 * stops retrying long before that.
 */
export const telegramUpdate = pgTable("telegram_updates", {
	updateId: bigint("update_id", { mode: "number" }).primaryKey(),
	receivedAt: timestamp("received_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
