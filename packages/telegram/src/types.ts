/**
 * The slice of Telegram's Update shape this bot actually reads.
 *
 * Hand-written rather than pulled from a library: the surface is small, and a
 * bot framework brings a runtime that has to be vetted for Workers anyway.
 */

export type TelegramUser = {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
	language_code?: string;
};

export type TelegramChat = {
	id: number;
	type: "private" | "group" | "supergroup" | "channel";
	title?: string;
};

/**
 * Where a forwarded message came from. Bot API 7.0+ sends `forward_origin`;
 * older clients and some relays still send only `forward_date`, so both are
 * treated as "this was forwarded".
 */
export type MessageOrigin = {
	type: "user" | "hidden_user" | "chat" | "channel";
	date: number;
	sender_user?: TelegramUser;
	sender_user_name?: string;
	chat?: TelegramChat;
	author_signature?: string;
};

export type PhotoSize = {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
};

export type TelegramMessage = {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
	/** Text that accompanies a photo or video — how most social posts arrive. */
	caption?: string;
	photo?: PhotoSize[];
	forward_origin?: MessageOrigin;
	/** Legacy forward marker, still sent by some clients. */
	forward_date?: number;
	/** Set when the user replies to a message; used by the edit flow. */
	reply_to_message?: TelegramMessage;
};

/** True when a message was forwarded rather than typed. */
export function isForwarded(message: TelegramMessage): boolean {
	return Boolean(message.forward_origin ?? message.forward_date);
}

/** The words in a message, wherever they live. */
export function messageText(message: TelegramMessage): string | undefined {
	return message.text ?? message.caption;
}

export type TelegramCallbackQuery = {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	/** Our own payload, at most 64 bytes — see callbackData(). */
	data?: string;
};

export type TelegramUpdate = {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
};

export type InlineKeyboardButton = {
	text: string;
	callback_data: string;
};

export type InlineKeyboardMarkup = {
	inline_keyboard: InlineKeyboardButton[][];
};

/**
 * Opens the reply composer already pointed at this message, so the person does
 * not have to know that replying is what links their text to the draft.
 */
export type ForceReplyMarkup = {
	force_reply: true;
	input_field_placeholder?: string;
	selective?: boolean;
};

export type ReplyMarkup = InlineKeyboardMarkup | ForceReplyMarkup;
