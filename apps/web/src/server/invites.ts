import {
	createInviteToken,
	INVITE_TTL_MINUTES,
	inviteLink,
} from "@et/telegram";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAccess } from "#/server/access";
import { fail } from "#/server/errors";
import { seatUsage } from "#/server/invite-core";
import { inviteSecret } from "#/server/telegram/client";

/**
 * Mints a Telegram invite for a workspace.
 *
 * Owners only, like web invites, and within the same limits the platform admin
 * sets: the team-invite switch and the seat limit. The link can be opened by
 * several people within its day, so the seat limit is checked again when each
 * one joins — see `handleStart`.
 */
export const createTelegramInvite = createServerFn({ method: "POST" })
	.validator(z.object({ orgId: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireAccess(data.orgId, "manage");

		const seats = await seatUsage(data.orgId);
		if (!seats.teamInvitesEnabled) {
			fail(
				"Team invites are turned off for this workspace. Contact your account manager.",
				403,
			);
		}
		if (seats.limit !== null && seats.used >= seats.limit) {
			fail(`This workspace has used all ${seats.limit} seats.`, 403);
		}

		const token = await createInviteToken({
			orgId: data.orgId,
			secret: inviteSecret(),
		});

		const botUsername = process.env.TELEGRAM_BOT_USERNAME;

		return {
			token,
			expiresInHours: INVITE_TTL_MINUTES / 60,
			/** Null until the bot's username is configured; the token still works. */
			link: botUsername ? inviteLink(botUsername, token) : null,
		};
	});
