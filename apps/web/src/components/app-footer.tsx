import { BRANDING } from "@et/core";
import { BrandMark } from "#/components/brand-mark";

export function AppFooter() {
	return (
		<footer className="mt-auto border-t py-brand-6">
			<div className="page-wrap flex flex-wrap items-center justify-between gap-brand-4 type-caption text-muted-foreground">
				<span className="inline-flex items-center gap-2">
					<BrandMark size={18} />
					{BRANDING.name} — {BRANDING.tagline}
				</span>
				<span>© {new Date().getFullYear()}</span>
			</div>
		</footer>
	);
}
