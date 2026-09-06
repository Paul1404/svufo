import {
	catalogKey,
	type HelperHourResolver,
	personKey,
} from "@/server/services/helper-hour-catalog";
import type { HelperHoursImportRow } from "@/server/services/helper-hours-import";

/**
 * A spelling the spreadsheet uses that the catalogue does not know yet. The
 * import asks about it once per spelling, not once per row, and the answer is
 * remembered as an alias so the same question is never asked twice.
 */
export type UnresolvedName = {
	art: "person" | "veranstaltung";
	schreibweise: string;
	rows: number;
	minutes: number;
	/** Catalogue entries that look close enough to be worth offering first. */
	vorschlaege: Array<{ id: string; label: string }>;
};

/** How a reviewer answered one unresolved spelling. */
export type NameDecision = {
	art: "person" | "veranstaltung";
	schreibweise: string;
	/** Existing catalogue entry, or "neu" to create one from the spelling. */
	ziel_id?: string;
	neu?: boolean;
};

function distance(a: string, b: string): number {
	const cols = b.length;
	let previous = Array.from({ length: cols + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i, ...Array<number>(cols).fill(0)];
		for (let j = 1; j <= cols; j++)
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		previous = current;
	}
	return previous[cols];
}

function personLabel(row: { nachname: string; vorname: string }) {
	return `${row.nachname}, ${row.vorname}`;
}

/**
 * Splits the parsed rows into what the catalogue already covers and what a
 * person still has to decide. Rows without a name are collective entries and
 * carry no person at all, which is a valid state rather than a gap.
 */
export function resolveImportNames(
	rows: HelperHoursImportRow[],
	resolver: HelperHourResolver,
) {
	const unresolvedPersons = new Map<string, UnresolvedName>();
	const unresolvedEvents = new Map<string, UnresolvedName>();

	for (const row of rows) {
		if (
			row.nachname &&
			row.vorname &&
			!resolver.person(row.nachname, row.vorname)
		) {
			const label = personLabel(row);
			const key = personKey(row.nachname, row.vorname);
			const entry = unresolvedPersons.get(key) ?? {
				art: "person" as const,
				schreibweise: label,
				rows: 0,
				minutes: 0,
				vorschlaege: resolver.persons
					.map((person) => ({
						person,
						score:
							distance(catalogKey(person.nachname), catalogKey(row.nachname)) +
							distance(catalogKey(person.vorname), catalogKey(row.vorname)),
					}))
					.filter((candidate) => candidate.score <= 3)
					.sort((a, b) => a.score - b.score)
					.slice(0, 5)
					.map((candidate) => ({
						id: candidate.person.id,
						label: personLabel(candidate.person),
					})),
			};
			entry.rows++;
			entry.minutes += row.gemeldete_summe_minuten;
			unresolvedPersons.set(key, entry);
		}
		if (!resolver.event(row.veranstaltung)) {
			const key = catalogKey(row.veranstaltung);
			const entry = unresolvedEvents.get(key) ?? {
				art: "veranstaltung" as const,
				schreibweise: row.veranstaltung,
				rows: 0,
				minutes: 0,
				vorschlaege: resolver.events
					.map((event) => ({
						event,
						score: distance(catalogKey(event.name), key),
					}))
					.filter((candidate) => candidate.score <= 4)
					.sort((a, b) => a.score - b.score)
					.slice(0, 5)
					.map((candidate) => ({
						id: candidate.event.id,
						label: candidate.event.name,
					})),
			};
			entry.rows++;
			entry.minutes += row.gemeldete_summe_minuten;
			unresolvedEvents.set(key, entry);
		}
	}
	const byUse = (a: UnresolvedName, b: UnresolvedName) => b.rows - a.rows;
	return {
		persons: [...unresolvedPersons.values()].sort(byUse),
		events: [...unresolvedEvents.values()].sort(byUse),
	};
}

export function parseNameDecisions(
	value: FormDataEntryValue | null,
): NameDecision[] | null {
	if (typeof value !== "string" || value.length > 200_000) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed) || parsed.length > 2_000) return null;
	const decisions: NameDecision[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") return null;
		const candidate = entry as Record<string, unknown>;
		if (
			(candidate.art !== "person" && candidate.art !== "veranstaltung") ||
			typeof candidate.schreibweise !== "string" ||
			candidate.schreibweise.length > 250 ||
			(candidate.ziel_id !== undefined &&
				typeof candidate.ziel_id !== "string") ||
			(candidate.neu !== undefined && typeof candidate.neu !== "boolean") ||
			(!candidate.ziel_id && !candidate.neu)
		)
			return null;
		decisions.push({
			art: candidate.art,
			schreibweise: candidate.schreibweise,
			ziel_id: candidate.ziel_id as string | undefined,
			neu: candidate.neu as boolean | undefined,
		});
	}
	return decisions;
}
