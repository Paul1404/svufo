import { ChevronRight } from "lucide-react";

/**
 * A section a reader can open when they want it. Used to keep the analysis on
 * the helper-hours page out of the way of the one task most members come for,
 * which is recording their hours. Built on `details` so it works without
 * JavaScript state and stays keyboard and screen-reader friendly.
 */
export function CollapsibleSection({
	title,
	description,
	defaultOpen = false,
	children,
}: {
	title: string;
	description?: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	return (
		<details className="group rounded-xl border bg-card" open={defaultOpen}>
			<summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
				<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
				<span className="min-w-0">
					<span className="block font-heading font-medium">{title}</span>
					{description ? (
						<span className="mt-0.5 block text-xs text-muted-foreground">
							{description}
						</span>
					) : null}
				</span>
			</summary>
			<div className="border-t p-4">{children}</div>
		</details>
	);
}
