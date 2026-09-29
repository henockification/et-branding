import type { ReplyMarkup } from "./types.ts";

const API_ROOT = "https://api.telegram.org";

export class TelegramError extends Error {
	readonly method: string;
	readonly description: string;
	readonly errorCode: number | undefined;

	constructor(method: string, description: string, errorCode?: number) {
		super(`Telegram ${method} failed: ${description}`);
		this.name = "TelegramError";
		this.method = method;
		this.description = description;
		this.errorCode = errorCode;
	}
}

/**
 * A thin typed wrapper over the Bot API.
 *
 * Every call goes through `call()`, which unwraps Telegram's `{ok, result}`
 * envelope — the API answers HTTP 200 for application-level failures, so
 * checking `response.ok` alone silently swallows errors.
 */
export class TelegramClient {
	private readonly token: string;

	constructor(token: string) {
		if (!token) {
			throw new Error("TELEGRAM_BOT_TOKEN is not set.");
		}
		this.token = token;
	}

	private async call<T>(
		method: string,
		payload: Record<string, unknown>,
	): Promise<T> {
		const response = await fetch(`${API_ROOT}/bot${this.token}/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});

		const body = (await response.json()) as {
			ok: boolean;
			result?: T;
			description?: string;
			error_code?: number;
		};

		if (!body.ok) {
			throw new TelegramError(
				method,
				body.description ?? `HTTP ${response.status}`,
				body.error_code,
			);
		}

		return body.result as T;
	}

	/**
	 * The multipart twin of `call()`, for methods that upload a file. Same
	 * envelope, same failure handling — only the body encoding differs.
	 */
	private async upload<T>(method: string, form: FormData): Promise<T> {
		const response = await fetch(`${API_ROOT}/bot${this.token}/${method}`, {
			method: "POST",
			body: form,
		});

		const body = (await response.json()) as {
			ok: boolean;
			result?: T;
			description?: string;
			error_code?: number;
		};

		if (!body.ok) {
			throw new TelegramError(
				method,
				body.description ?? `HTTP ${response.status}`,
				body.error_code,
			);
		}

		return body.result as T;
	}

	/**
	 * Downloads a file someone sent the bot.
	 *
	 * Two steps because the Bot API only hands out a short-lived path, not the
	 * bytes. Bots can fetch files up to 20 MB; a phone photo is far below that.
	 */
	async downloadFile(fileId: string): Promise<Uint8Array<ArrayBuffer>> {
		const file = await this.call<{ file_path?: string }>("getFile", {
			file_id: fileId,
		});

		if (!file.file_path) {
			throw new TelegramError("getFile", "Telegram returned no file path.");
		}

		const response = await fetch(
			`${API_ROOT}/file/bot${this.token}/${file.file_path}`,
		);

		if (!response.ok) {
			throw new TelegramError(
				"getFile",
				`download failed: HTTP ${response.status}`,
			);
		}

		return new Uint8Array(await response.arrayBuffer());
	}

	/** Uploads a JPEG. Telegram caps photos at 10 MB and 10,000px on both sides combined. */
	sendPhoto(options: {
		chatId: number;
		photo: Uint8Array<ArrayBuffer>;
		caption?: string;
		replyMarkup?: ReplyMarkup;
	}): Promise<{ message_id: number }> {
		const form = new FormData();
		form.set("chat_id", String(options.chatId));
		form.set(
			"photo",
			new Blob([options.photo], { type: "image/jpeg" }),
			"photo.jpg",
		);
		if (options.caption) {
			form.set("caption", options.caption);
			form.set("parse_mode", "HTML");
		}
		if (options.replyMarkup) {
			form.set("reply_markup", JSON.stringify(options.replyMarkup));
		}
		return this.upload("sendPhoto", form);
	}

	/** Swaps the image in a photo message that is already in the chat. */
	editMessagePhoto(options: {
		chatId: number;
		messageId: number;
		photo: Uint8Array<ArrayBuffer>;
		caption?: string;
		replyMarkup?: ReplyMarkup;
	}): Promise<unknown> {
		const form = new FormData();
		form.set("chat_id", String(options.chatId));
		form.set("message_id", String(options.messageId));
		// `attach://` points the media description at a part of this same upload.
		form.set(
			"media",
			JSON.stringify({
				type: "photo",
				media: "attach://photo",
				...(options.caption
					? { caption: options.caption, parse_mode: "HTML" }
					: {}),
			}),
		);
		form.set(
			"photo",
			new Blob([options.photo], { type: "image/jpeg" }),
			"photo.jpg",
		);
		form.set(
			"reply_markup",
			JSON.stringify(options.replyMarkup ?? { inline_keyboard: [] }),
		);
		return this.upload("editMessageMedia", form);
	}

	sendMessage(options: {
		chatId: number;
		text: string;
		replyMarkup?: ReplyMarkup;
		replyToMessageId?: number;
	}): Promise<{ message_id: number }> {
		return this.call("sendMessage", {
			chat_id: options.chatId,
			text: options.text,
			// HTML over Markdown: Amharic and brand copy contain underscores and
			// asterisks that Markdown would swallow or reject.
			parse_mode: "HTML",
			link_preview_options: { is_disabled: true },
			...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
			...(options.replyToMessageId
				? { reply_to_message_id: options.replyToMessageId }
				: {}),
		});
	}

	editMessageText(options: {
		chatId: number;
		messageId: number;
		text: string;
		replyMarkup?: ReplyMarkup;
	}): Promise<unknown> {
		return this.call("editMessageText", {
			chat_id: options.chatId,
			message_id: options.messageId,
			text: options.text,
			parse_mode: "HTML",
			link_preview_options: { is_disabled: true },
			reply_markup: options.replyMarkup ?? { inline_keyboard: [] },
		});
	}

	/**
	 * Telegram shows a spinner on a tapped button until this is called, so it
	 * runs on every callback — including failures.
	 */
	answerCallbackQuery(options: {
		callbackQueryId: string;
		text?: string;
	}): Promise<unknown> {
		return this.call("answerCallbackQuery", {
			callback_query_id: options.callbackQueryId,
			...(options.text ? { text: options.text } : {}),
		});
	}

	sendChatAction(options: {
		chatId: number;
		action: "typing" | "upload_photo";
	}): Promise<unknown> {
		return this.call("sendChatAction", {
			chat_id: options.chatId,
			action: options.action,
		});
	}

	/**
	 * Points Telegram at this deployment. `secretToken` is echoed back in the
	 * X-Telegram-Bot-Api-Secret-Token header on every update, which is what
	 * makes the public webhook URL safe to expose.
	 */
	setWebhook(options: { url: string; secretToken: string }): Promise<unknown> {
		return this.call("setWebhook", {
			url: options.url,
			secret_token: options.secretToken,
			allowed_updates: ["message", "callback_query"],
			drop_pending_updates: true,
		});
	}

	/**
	 * Registers the command list Telegram shows behind the blue Menu button and
	 * when someone types "/". Without it that menu is empty and every command has
	 * to be memorised.
	 *
	 * Verified against the live API: BotCommand is `{command, description}`.
	 */
	setMyCommands(
		commands: readonly { command: string; description: string }[],
	): Promise<boolean> {
		return this.call("setMyCommands", { commands });
	}

	getMe(): Promise<{ id: number; username: string; first_name: string }> {
		return this.call("getMe", {});
	}
}

/** Telegram rejects text over 4096 characters; trim with a visible marker. */
export function truncateForTelegram(text: string, limit = 4000): string {
	return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Escapes the three characters Telegram's HTML parse mode treats specially. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
