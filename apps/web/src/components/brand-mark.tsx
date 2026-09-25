import { BRANDING, LOGO } from "@et/core";

/**
 * The Social Brain mark. Two files, one per ground: the Ultraviolet mark on
 * light, the white mark on the dark violet surface. The system forbids
 * recolouring the mark, so this swaps files rather than filtering one.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
	return (
		<>
			<img
				src={LOGO.primary}
				alt=""
				width={size}
				height={size}
				className="block dark:hidden"
			/>
			<img
				src={LOGO.reverse}
				alt=""
				width={size}
				height={size}
				className="hidden dark:block"
			/>
		</>
	);
}

/**
 * Mark plus wordmark. Per the system: Space Grotesk Bold at −2% tracking, cap
 * height about 40% of the mark's height, spaced one dot-width to the right.
 */
export function BrandLockup({ size = 28 }: { size?: number }) {
	return (
		<span className="inline-flex items-center" style={{ gap: size / 6 }}>
			<BrandMark size={size} />
			<span className="wordmark" style={{ fontSize: size * 0.58 }}>
				{BRANDING.name}
			</span>
		</span>
	);
}
