import { draftPost, isNeutral, readPhoto } from "@et/agents";
import {
	agentRun,
	and,
	type ContentPhoto,
	contentItem,
	eq,
	getDb,
} from "@et/db";
import { escapeHtml, truncateForTelegram } from "@et/telegram";
import {
	getPhoto,
	mediaKeys,
	normalise,
	polish,
	preview,
	putPhoto,
} from "#/server/media";
import { getTelegram, tell } from "#/server/telegram/client";
import {
	draftFooter,
	draftKeyboard,
	loadBrandContext,
	photoKeyboard,
} from "#/server/telegram/context";

/** As in draft.ts: the client's Meta pages are the first target. */
const DEFAULT_CHANNEL = "facebook" as const;

const MAX_BODY_LENGTH = 3000;

type PhotoDraftCommand = {
	orgId: string;
	chatId: number;
	/** Telegram's id for the largest version of the photo. */
	fileId: string;
	/** What they typed with it. Empty is fine: the photo is the brief. */
	caption: string;
};

/**
 * A photo in, a polished photo and a post about it out.
 *
 * Mirrors `handleDraftCommand`, with three steps in front: keep the original,
 * have a vision model read the photo and choose a light edit, and apply that
 * edit. The post is then written by the usual brand model from what the vision
 * model saw, so photo posts sound like every other post.
 *
 * The photo and the draft go out as two messages — photo first, the draft as a
 * reply to it. Keeping the draft a plain text message is what lets Edit, Refine
 * and reply-to-change keep working on it unchanged; a caption would cap the
 * post at 1,024 characters and need a different edit call.
 */
export async function handlePhotoDraft(
	command: PhotoDraftCommand,
): Promise<void> {
	const telegram = getTelegram();
	const db = getDb();

	const loaded = await loadBrandContext(command.orgId);

	if (!loaded) {
		await tell(
			command.chatId,
			"This workspace has no brand profile yet, so I have nothing to write in the voice of.",
		);
		return;
	}

	await telegram
		.sendChatAction({ chatId: command.chatId, action: "upload_photo" })
		.catch(() => {});

	const [run] = await db
		.insert(agentRun)
		.values({
			orgId: command.orgId,
			agent: "content",
			input: { brief: command.caption, photo: true, ...loaded.counts },
			status: "running",
		})
		.returning({ id: agentRun.id });

	let delivered: {
		body: string;
		itemId: string;
		note: string;
		photo: Uint8Array<ArrayBuffer>;
	};

	try {
		const mediaId = crypto.randomUUID();
		const keys = mediaKeys(command.orgId, mediaId);

		const original = await normalise(
			await telegram.downloadFile(command.fileId),
		);
		await putPhoto(keys.original, original.jpeg);

		const reading = await readPhoto({
			image: await preview(original.jpeg),
			mediaType: "image/jpeg",
			caption: command.caption,
			brand: loaded.brand,
		});

		const untouched = isNeutral(reading.adjustments);

		// A photo that already looks right is left alone rather than re-encoded
		// for nothing. Stored under the polished key anyway, so every photo post
		// has the same shape.
		const polished = untouched
			? original.jpeg
			: await polish({
					jpeg: original.jpeg,
					width: original.width,
					height: original.height,
					adjustments: reading.adjustments,
					favourFaces: reading.peopleAreTheSubject,
				});
		await putPhoto(keys.polished, polished);

		await telegram
			.sendChatAction({ chatId: command.chatId, action: "typing" })
			.catch(() => {});

		const draft = await draftPost({
			brand: loaded.brand,
			brief: command.caption,
			photo: {
				description: reading.description,
				visibleText: reading.visibleText,
			},
		});

		const body = draft.output.slice(0, MAX_BODY_LENGTH);

		const photo: ContentPhoto = {
			kind: "photo",
			id: mediaId,
			originalKey: keys.original,
			polishedKey: keys.polished,
			selected: "polished",
			adjustments: reading.adjustments,
			description: reading.description,
		};

		const [item] = await db
			.insert(contentItem)
			.values({
				orgId: command.orgId,
				type: "post",
				channel: DEFAULT_CHANNEL,
				language: draft.language.code,
				body,
				media: [photo],
				status: "draft",
			})
			.returning({ id: contentItem.id });

		if (!item) throw new Error("Draft could not be saved.");

		// Two models, one run: the action log should show what the post cost,
		// not what half of it cost.
		const usd = reading.cost.usd + draft.cost.usd;

		if (run) {
			await db
				.update(agentRun)
				.set({
					status: "succeeded",
					modelId: draft.modelId,
					output: {
						contentItemId: item.id,
						body,
						visionModelId: reading.modelId,
						visionUsd: reading.cost.usd,
						description: reading.description,
						adjustments: reading.adjustments,
						proposedAdjustments: reading.proposed,
					},
					inputTokens: reading.cost.inputTokens + draft.cost.inputTokens,
					outputTokens: reading.cost.outputTokens + draft.cost.outputTokens,
					usd: usd.toFixed(6),
					finishedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(agentRun.id, run.id));
		}

		const learned =
			loaded.counts.pastPosts +
			loaded.counts.approved +
			loaded.counts.corrections;

		delivered = {
			body,
			itemId: item.id,
			photo: polished,
			note: [
				draft.language.label,
				`learning from ${learned}`,
				untouched ? "photo already looked right" : "photo polished",
				`$${usd.toFixed(6)}`,
			].join(" · "),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		if (run) {
			await db
				.update(agentRun)
				.set({
					status: "failed",
					error: message.slice(0, 500),
					finishedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(agentRun.id, run.id));
		}

		await tell(
			command.chatId,
			`I could not work with that photo.\n\n<code>${escapeHtml(message.slice(0, 300))}</code>`,
		);
		return;
	}

	// The draft is saved by now. A failed photo upload must not also lose the
	// text, so the photo is best-effort and the draft is sent regardless.
	let photoMessageId: number | undefined;
	try {
		const sent = await telegram.sendPhoto({
			chatId: command.chatId,
			photo: delivered.photo,
			replyMarkup: photoKeyboard(delivered.itemId, "polished"),
		});
		photoMessageId = sent.message_id;
	} catch (error) {
		console.error("telegram sendPhoto failed", error);
	}

	await telegram.sendMessage({
		chatId: command.chatId,
		text: truncateForTelegram(
			[
				escapeHtml(delivered.body),
				"",
				draftFooter(delivered.itemId, delivered.note),
			].join("\n"),
		),
		replyMarkup: draftKeyboard(delivered.itemId),
		...(photoMessageId ? { replyToMessageId: photoMessageId } : {}),
	});
}

/**
 * "Use original" / "Use polished" under a photo.
 *
 * Records the choice on the draft, then swaps the picture in the chat so what
 * is on screen is what will be posted.
 */
export async function choosePhoto(options: {
	orgId: string;
	chatId: number;
	messageId: number;
	itemId: string;
	choice: "original" | "polished";
}): Promise<"ok" | "gone" | "published"> {
	const db = getDb();

	const [item] = await db
		.select({ media: contentItem.media, status: contentItem.status })
		.from(contentItem)
		.where(
			and(
				eq(contentItem.id, options.itemId),
				eq(contentItem.orgId, options.orgId),
			),
		)
		.limit(1);

	const photo = item?.media?.find((media) => media.kind === "photo");
	if (!item || !photo) return "gone";

	// Once it is out, changing the stored choice would misdescribe what was posted.
	if (item.status === "published") return "published";

	const bytes = await getPhoto(
		options.choice === "original" ? photo.originalKey : photo.polishedKey,
	);
	if (!bytes) return "gone";

	await db
		.update(contentItem)
		.set({
			media: (item.media ?? []).map((media) =>
				media.id === photo.id ? { ...media, selected: options.choice } : media,
			),
			updatedAt: new Date(),
		})
		.where(eq(contentItem.id, options.itemId));

	await getTelegram().editMessagePhoto({
		chatId: options.chatId,
		messageId: options.messageId,
		photo: bytes,
		replyMarkup: photoKeyboard(options.itemId, options.choice),
	});

	return "ok";
}
