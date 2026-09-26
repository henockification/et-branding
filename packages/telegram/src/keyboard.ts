import type { ReplyKeyboardMarkup } from "./types.ts";

/**
 * The persistent keyboard.
 *
 * Tapping a reply-keyboard button sends its literal text, so these labels are
 * protocol: the router matches them through `normaliseLabel` below. Emoji and
 * case are stripped on both sides, so a label can gain or lose decoration
 * without breaking, and someone typing "help" by hand hits the same path.
 */
export const KEYBOARD_ACTIONS = {
	draft: "✍️ Write a post",
	plan: "🗓 This week",
	brain: "🧠 What you know",
	help: "❓ Help",
} as const;

export type KeyboardAction = keyof typeof KEYBOARD_ACTIONS;

export const MAIN_KEYBOARD: ReplyKeyboardMarkup = {
	keyboard: [
		[{ text: KEYBOARD_ACTIONS.draft }, { text: KEYBOARD_ACTIONS.plan }],
		[{ text: KEYBOARD_ACTIONS.brain }, { text: KEYBOARD_ACTIONS.help }],
	],
	resize_keyboard: true,
	is_persistent: true,
	input_field_placeholder: "Tell me what to write…",
};

/** Lowercase, strip everything that is not a letter, digit or space. */
export function normaliseLabel(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number} ]+/gu, "")
		.replace(/\s+/g, " ")
		.trim();
}

const BY_LABEL = new Map<string, KeyboardAction>(
	Object.entries(KEYBOARD_ACTIONS).map(([action, label]) => [
		normaliseLabel(label),
		action as KeyboardAction,
	]),
);

/** Which keyboard button this text came from, if any. */
export function keyboardAction(text: string): KeyboardAction | undefined {
	return BY_LABEL.get(normaliseLabel(text));
}
