import type { ReactNode } from "react";
import { BrandMark } from "#/components/brand-mark";

export function AuthCard({
	title,
	subtitle,
	children,
	footer,
}: {
	title: string;
	subtitle: string;
	children: ReactNode;
	footer: ReactNode;
}) {
	return (
		<main className="page-wrap flex justify-center py-brand-12">
			<div className="w-full max-w-sm space-y-brand-6">
				<div className="space-y-2">
					<BrandMark size={32} />
					<h1 className="type-display-l">{title}</h1>
					<p className="type-body text-muted-foreground">{subtitle}</p>
				</div>

				<div className="space-y-brand-4 rounded-lg border bg-card p-brand-6">
					{children}
				</div>

				<p className="type-caption text-muted-foreground">{footer}</p>
			</div>
		</main>
	);
}

export function FieldError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p className="type-caption text-destructive" role="alert">
			{message}
		</p>
	);
}
