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
		action: "typing";
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
