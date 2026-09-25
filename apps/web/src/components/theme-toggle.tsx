import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "#/components/ui/button";
import { type ThemePreference, useTheme } from "#/lib/theme";

const LABELS: Record<ThemePreference, string> = {
	system: "Match system",
	light: "Light",
	dark: "Dark",
};

const ICONS: Record<ThemePreference, typeof Sun> = {
	system: Monitor,
	light: Sun,
	dark: Moon,
};

/** Cycles system → light → dark. Three states, so one button is enough. */
export function ThemeToggle() {
	const { preference, cyclePreference, mounted } = useTheme();
	const Icon = ICONS[preference];

	return (
		<Button
			variant="ghost"
			size="icon"
			onClick={cyclePreference}
			// Until mounted the label would describe the server's guess, not the
			// visitor's actual theme, so keep it out of the accessibility tree.
			aria-label={mounted ? `Theme: ${LABELS[preference]}` : "Change theme"}
			title={mounted ? LABELS[preference] : undefined}
		>
			<Icon className="size-4" aria-hidden="true" />
		</Button>
	);
}
