/** Marketing Studio's allowance, in credits — never in money. */
export function CreditsBadge({
	credits,
}: {
	credits: { remaining: number; monthly: number } | null;
}) {
	if (!credits) return null;
	return (
		<span className="rounded-full border px-3 py-1 type-caption">
			{credits.remaining} / {credits.monthly} credits left this month
		</span>
	);
}
