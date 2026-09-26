import { and, eq, getDb, orgMember } from "@et/db";
import {
	createInviteToken,
	INVITE_TTL_MINUTES,
	inviteLink,
} from "@et/telegram";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAuth } from "#/server/auth";
import { inviteSecret } from "#/server/telegram/client";

/**
 * Mints a Telegram invite for a workspace.
 *
 * Owners and approvers only: an invite is the thing that grants access, so the
 * check is membership-and-role, not just "signed in". The org id comes from the
 * client, which is exactly why it is verified against the caller's membership
 * before anything is signed.
 */
export const createTelegramInvite = createServerFn({ method: "POST" })
	.validator(z.object({ orgId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const request = getRequest();
		const session = await getAuth().api.getSession({
			headers: request.headers,
		});

		if (!session) {
			throw new Response("Not signed in.", { status: 401 });
		}

		const [membership] = await getDb()
			.select({ role: orgMember.role })
			.from(orgMember)
			.where(
				and(
					eq(orgMember.orgId, data.orgId),
					eq(orgMember.userId, session.user.id),
				),
			)
			.limit(1);

		if (!membership || membership.role === "member") {
			throw new Response("Not allowed to invite for this workspace.", {
				status: 403,
			});
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
