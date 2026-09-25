import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "et-theme";

const PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

function isThemePreference(value: unknown): value is ThemePreference {
	return (
		typeof value === "string" && PREFERENCES.includes(value as ThemePreference)
	);
}

function readStoredPreference(): ThemePreference {
	try {
		const stored = localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(stored) ? stored : "system";
	} catch {
		// Private browsing and blocked site data both throw here.
		return "system";
	}
}

function prefersDark(): boolean {
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyPreference(preference: ThemePreference): void {
	const dark =
		preference === "dark" || (preference === "system" && prefersDark());
	const root = document.documentElement;
	root.classList.toggle("dark", dark);
	// Tells the browser which palette to use for scrollbars and form controls.
	root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Runs before first paint, inlined in the document head.
 *
 * The server cannot know the visitor's preference, so the markup it sends is
 * always light. Without this, a dark-mode visitor would see a white flash on
 * every page load — the class has to be on `<html>` before the browser paints,
 * which rules out doing it in an effect.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
	THEME_STORAGE_KEY,
)});if(p!=="light"&&p!=="dark"&&p!=="system"){p="system"}var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}})()`;

/**
 * Reads and writes the visitor's theme preference.
 *
 * Returns "system" until mounted, matching what the server rendered, so the
 * first client render agrees with the markup and React does not warn about a
 * hydration mismatch. The inline script above has already applied the real
 * theme by then, so nothing visibly changes.
 */
export function useTheme(): {
	preference: ThemePreference;
	setPreference: (next: ThemePreference) => void;
	cyclePreference: () => void;
	mounted: boolean;
} {
	const [preference, setPreferenceState] = useState<ThemePreference>("system");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setPreferenceState(readStoredPreference());
		setMounted(true);
	}, []);

	// While on "system", track OS changes live rather than only on reload.
	useEffect(() => {
		if (preference !== "system") return;

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyPreference("system");
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [preference]);

	const setPreference = useCallback((next: ThemePreference) => {
		setPreferenceState(next);
		applyPreference(next);
		try {
			localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch {
			// A preference we cannot persist still applies for this page view.
		}
	}, []);

	const cyclePreference = useCallback(() => {
		setPreferenceState((current) => {
			const next =
				PREFERENCES[(PREFERENCES.indexOf(current) + 1) % PREFERENCES.length] ??
				"system";
			applyPreference(next);
			try {
				localStorage.setItem(THEME_STORAGE_KEY, next);
			} catch {
				// See above.
			}
			return next;
		});
	}, []);

	return { preference, setPreference, cyclePreference, mounted };
}
