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

export type TelegramMessage = {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
};

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

export type ReplyMarkup = {
	inline_keyboard: InlineKeyboardButton[][];
};
