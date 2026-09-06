import { and, asc, eq, ne, or, sql } from "drizzle-orm";
import type {
	HelperHourAliasCreateInput,
	HelperHourEventInput,
	HelperHourPersonInput,
	HelperHourPersonMergeInput,
} from "@/lib/schemas";
import { db } from "@/server/db";
import {
	helperHourAliases,
	helperHourEvents,
	helperHourPersons,
	helperHours,
} from "@/server/db/schema";
import type { AuthUser } from "@/server/orpc/base";
import {
	type RecordAuditInput,
	recordAuditEventStrict,
} from "@/server/services/audit";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Comparison form for catalogue lookups and alias matching. */
export function catalogKey(value: string): string {
	return value.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

export function personKey(nachname: string, vorname: string): string {
	return `${catalogKey(nachname)}|${catalogKey(vorname)}`;
}

export async function listHelperHourPersons(tx: Tx | typeof db = db) {
	return tx
		.select({
			id: helperHourPersons.id,
			nachname: helperHourPersons.nachname,
			vorname: helperHourPersons.vorname,
			aktiv: helperHourPersons.aktiv,
		})
		.from(helperHourPersons)
		.orderBy(asc(helperHourPersons.nachname), asc(helperHourPersons.vorname));
}

export async function listHelperHourEvents(tx: Tx | typeof db = db) {
	return tx
		.select({
			id: helperHourEvents.id,
			name: helperHourEvents.name,
			aktiv: helperHourEvents.aktiv,
		})
		.from(helperHourEvents)
		.orderBy(asc(helperHourEvents.name));
}

export async function listHelperHourAliases(tx: Tx | typeof db = db) {
	return tx
		.select({
			id: helperHourAliases.id,
			art: helperHourAliases.art,
			schreibweise: helperHourAliases.schreibweise,
			person_id: helperHourAliases.person_id,
			veranstaltung_id: helperHourAliases.veranstaltung_id,
		})
		.from(helperHourAliases)
		.orderBy(asc(helperHourAliases.art), asc(helperHourAliases.schreibweise));
}

/** Catalogue entries with how much they are used, for the settings screen. */
export async function listHelperHourCatalog() {
	const [persons, events, aliases, personUse, eventUse] = await Promise.all([
		listHelperHourPersons(),
		listHelperHourEvents(),
		listHelperHourAliases(),
		db
			.select({
				person_id: helperHours.person_id,
				entries: sql<number>`count(*)`,
				minutes: sql<number>`coalesce(sum(${helperHours.gemeldete_summe_minuten}), 0)`,
			})
			.from(helperHours)
			.groupBy(helperHours.person_id),
		db
			.select({
				veranstaltung_id: helperHours.veranstaltung_id,
				entries: sql<number>`count(*)`,
			})
			.from(helperHours)
			.groupBy(helperHours.veranstaltung_id),
	]);
	const byPerson = new Map(
		personUse.map((row) => [
			row.person_id,
			{ entries: Number(row.entries), minutes: Number(row.minutes) },
		]),
	);
	const byEvent = new Map(
		eventUse.map((row) => [row.veranstaltung_id, Number(row.entries)]),
	);
	return {
		persons: persons.map((person) => ({
			...person,
			entries: byPerson.get(person.id)?.entries ?? 0,
			minutes: byPerson.get(person.id)?.minutes ?? 0,
			aliases: aliases
				.filter((alias) => alias.person_id === person.id)
				.map((alias) => alias.schreibweise),
		})),
		events: events.map((event) => ({
			...event,
			entries: byEvent.get(event.id) ?? 0,
			aliases: aliases
				.filter((alias) => alias.veranstaltung_id === event.id)
				.map((alias) => alias.schreibweise),
		})),
	};
}

export async function createHelperHourPerson(
	input: HelperHourPersonInput,
	actor: AuthUser,
	audit: Pick<RecordAuditInput, "request">,
) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(helperHourPersons)
			.values({
				nachname: input.nachname,
				vorname: input.vorname,
				erstellt_von_user_id: actor.id,
				erstellt_von_name: actor.name,
			})
			.onConflictDoNothing()
			.returning();
		if (!row) throw new Error("Diese Person gibt es schon im Katalog");
		await recordAuditEventStrict(tx, {
			category: "helferstunden",
			action: "helferstunden.person_created",
			actor,
			request: audit.request,
			subject: {
				type: "helferstunden_person",
				id: row.id,
				label: `${row.nachname}, ${row.vorname}`,
			},
			metadata: {},
		});
		return row;
	});
}

export async function updateHelperHourPerson(
	input: HelperHourPersonInput & { id: string; aktiv: boolean },
	actor: AuthUser,
	audit: Pick<RecordAuditInput, "request">,
) {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(helperHourPersons)
			.where(eq(helperHourPersons.id, input.id))
			.limit(1);
		if (!current) throw new Error("Person nicht gefunden");
		const [duplicate] = await tx
			.select({ id: helperHourPersons.id })
			.from(helperHourPersons)
			.where(
				and(
					ne(helperHourPersons.id, input.id),
					sql`lower(trim(${helperHourPersons.nachname})) = ${catalogKey(input.nachname)}`,
					sql`lower(trim(${helperHourPersons.vorname})) = ${catalogKey(input.vorname)}`,
				),
			)
			.limit(1);
		if (duplicate) throw new Error("Diese Person gibt es schon im Katalog");
		const [row] = await tx
			.update(helperHourPersons)
			.set({
				nachname: input.nachname,
				vorname: input.vorname,
				aktiv: input.aktiv,
			})
			.where(eq(helperHourPersons.id, input.id))
			.returning();
		await recordAuditEventStrict(tx, {
			category: "helferstunden",
			action: "helferstunden.person_updated",
			actor,
			request: audit.request,
			subject: {
				type: "helferstunden_person",
				id: row.id,
				label: `${row.nachname}, ${row.vorname}`,
			},
			metadata: {
				vorher: `${current.nachname}, ${current.vorname}`,
				nachher: `${row.nachname}, ${row.vorname}`,
				aktiv: row.aktiv,
			},
		});
		return row;
	});
}

/**
 * Folds one catalogue entry into another: the hours move, the losing spelling
 * is kept as an alias so a future import of the same list resolves to the
 * survivor instead of recreating the duplicate.
 */
export async function mergeHelperHourPersons(
	input: HelperHourPersonMergeInput,
	actor: AuthUser,
	audit: Pick<RecordAuditInput, "request">,
) {
	if (input.von_id === input.nach_id)
		throw new Error("Quelle und Ziel sind dieselbe Person");
	return db.transaction(async (tx) => {
		const rows = await tx
			.select()
			.from(helperHourPersons)
			.where(
				or(
					eq(helperHourPersons.id, input.von_id),
					eq(helperHourPersons.id, input.nach_id),
				),
			);
		const von = rows.find((row) => row.id === input.von_id);
		const nach = rows.find((row) => row.id === input.nach_id);
		if (!von || !nach) throw new Error("Person nicht gefunden");
		const moved = await tx
			.update(helperHours)
			.set({ person_id: nach.id })
			.where(eq(helperHours.person_id, von.id))
			.returning({ id: helperHours.id });
		// Aliases of the losing entry follow it, and its own spelling becomes one.
		await tx
			.update(helperHourAliases)
			.set({ person_id: nach.id })
			.where(eq(helperHourAliases.person_id, von.id));
		await tx
			.insert(helperHourAliases)
			.values({
				art: "person",
				schreibweise: `${von.nachname}, ${von.vorname}`,
				person_id: nach.id,
				erstellt_von_user_id: actor.id,
				erstellt_von_name: actor.name,
			})
			.onConflictDoNothing();
		await tx.delete(helperHourPersons).where(eq(helperHourPersons.id, von.id));
		await recordAuditEventStrict(tx, {
			category: "helferstunden",
			action: "helferstunden.person_merged",
			actor,
			request: audit.request,
			subject: {
				type: "helferstunden_person",
				id: nach.id,
				label: `${nach.nachname}, ${nach.vorname}`,
			},
			metadata: {
				von: `${von.nachname}, ${von.vorname}`,
				nach: `${nach.nachname}, ${nach.vorname}`,
				umgebuchte_eintraege: moved.length,
			},
		});
		return { id: nach.id, moved: moved.length };
	});
}

export async function createHelperHourEvent(
	input: HelperHourEventInput,
	actor: AuthUser,
	audit: Pick<RecordAuditInput, "request">,
) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(helperHourEvents)
			.values({
				name: input.name,
				erstellt_von_user_id: actor.id,
				erstellt_von_name: actor.name,
			})
			.onConflictDoNothing()
			.returning();
		if (!row) throw new Error("Diese Veranstaltung gibt es schon im Katalog");
		await recordAuditEventStrict(tx, {
			category: "helferstunden",
			action: "helferstunden.event_created",
			actor,
			request: audit.request,
			subject: {
				type: "helferstunden_veranstaltung",
				id: row.id,
				label: row.name,
			},
			metadata: {},
		});
		return row;
	});
}

export async function updateHelperHourEvent(
	input: HelperHourEventInput & { id: string; aktiv: boolean },
	actor: AuthUser,
	audit: Pick<RecordAuditInput, "request">,
) {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(helperHourEvents)
			.where(eq(helperHourEvents.id, input.id))
			.limit(1);
		if (!current) throw new Error("Veranstaltung nicht gefunden");
		const [duplicate] = await tx
			.select({ id: helperHourEvents.id })
			.from(helperHourEvents)
			.where(
				and(
					ne(helperHourEvents.id, input.id),
					sql`lower(trim(${helperHourEvents.name})) = ${catalogKey(input.name)}`,
				),
			)
			.limit(1);
		if (duplicate)
			throw new Error("Diese Veranstaltung gibt es schon im Katalog");
		const [row] = await tx
			.update(helperHourEvents)
			.set({ name: input.name, aktiv: input.aktiv })
			.where(eq(helperHourEvents.id, input.id))
			.returning();
		await recordAuditEventStrict(tx, {
			category: "helferstunden",
			action: "helferstunden.event_updated",
			actor,
			request: audit.request,
			subject: {
				type: "helferstunden_veranstaltung",
				id: row.id,
				label: row.name,
			},
			metadata: { vorher: current.name, nachher: row.name, aktiv: row.aktiv },
		});
		return row;
	});
}

export async function mergeHelperHourEvents(
	input: { von_id: string; nach_id: string },
	actor: AuthUser,
	audit: Pick<RecordAuditInput, "request">,
) {
	if (input.von_id === input.nach_id)
		throw new Error("Quelle und Ziel sind dieselbe Veranstaltung");
	return db.transaction(async (tx) => {
		const rows = await tx
			.select()
			.from(helperHourEvents)
			.where(
				or(
					eq(helperHourEvents.id, input.von_id),
					eq(helperHourEvents.id, input.nach_id),
				),
			);
		const von = rows.find((row) => row.id === input.von_id);
		const nach = rows.find((row) => row.id === input.nach_id);
		if (!von || !nach) throw new Error("Veranstaltung nicht gefunden");
		const moved = await tx
			.update(helperHours)
			.set({ veranstaltung_id: nach.id })
			.where(eq(helperHours.veranstaltung_id, von.id))
			.returning({ id: helperHours.id });
		await tx
			.update(helperHourAliases)
			.set({ veranstaltung_id: nach.id })
			.where(eq(helperHourAliases.veranstaltung_id, von.id));
		await tx
			.insert(helperHourAliases)
			.values({
				art: "veranstaltung",
				schreibweise: von.name,
				veranstaltung_id: nach.id,
				erstellt_von_user_id: actor.id,
				erstellt_von_name: actor.name,
			})
			.onConflictDoNothing();
		await tx.delete(helperHourEvents).where(eq(helperHourEvents.id, von.id));
		await recordAuditEventStrict(tx, {
			category: "helferstunden",
			action: "helferstunden.event_merged",
			actor,
			request: audit.request,
			subject: {
				type: "helferstunden_veranstaltung",
				id: nach.id,
				label: nach.name,
			},
			metadata: {
				von: von.name,
				nach: nach.name,
				umgebuchte_eintraege: moved.length,
			},
		});
		return { id: nach.id, moved: moved.length };
	});
}

export async function createHelperHourAlias(
	input: HelperHourAliasCreateInput,
	actor: AuthUser,
	audit: Pick<RecordAuditInput, "request">,
) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(helperHourAliases)
			.values({
				art: input.art,
				schreibweise: input.schreibweise,
				person_id: input.art === "person" ? input.ziel_id : null,
				veranstaltung_id: input.art === "veranstaltung" ? input.ziel_id : null,
				erstellt_von_user_id: actor.id,
				erstellt_von_name: actor.name,
			})
			.onConflictDoNothing()
			.returning();
		if (!row)
			throw new Error("Für diese Schreibweise gibt es bereits eine Zuordnung");
		await recordAuditEventStrict(tx, {
			category: "helferstunden",
			action: "helferstunden.alias_created",
			actor,
			request: audit.request,
			subject: {
				type: "helferstunden_zuordnung",
				id: row.id,
				label: row.schreibweise,
			},
			metadata: { art: row.art, ziel: input.ziel_id },
		});
		return row;
	});
}

export async function deleteHelperHourAlias(
	id: string,
	actor: AuthUser,
	audit: Pick<RecordAuditInput, "request">,
) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.delete(helperHourAliases)
			.where(eq(helperHourAliases.id, id))
			.returning();
		if (!row) throw new Error("Zuordnung nicht gefunden");
		await recordAuditEventStrict(tx, {
			category: "helferstunden",
			action: "helferstunden.alias_deleted",
			actor,
			request: audit.request,
			subject: {
				type: "helferstunden_zuordnung",
				id: row.id,
				label: row.schreibweise,
			},
			metadata: { art: row.art },
		});
		return { id: row.id };
	});
}

/**
 * Everything the import needs to turn the spreadsheet's free text into
 * catalogue references, loaded once per import.
 */
export async function loadHelperHourResolver() {
	const [persons, events, aliases] = await Promise.all([
		listHelperHourPersons(),
		listHelperHourEvents(),
		listHelperHourAliases(),
	]);
	const personByName = new Map(
		persons.map((person) => [
			personKey(person.nachname, person.vorname),
			person,
		]),
	);
	const eventByName = new Map(
		events.map((event) => [catalogKey(event.name), event]),
	);
	const personByAlias = new Map<string, string>();
	const eventByAlias = new Map<string, string>();
	for (const alias of aliases) {
		if (alias.art === "person" && alias.person_id)
			personByAlias.set(catalogKey(alias.schreibweise), alias.person_id);
		if (alias.art === "veranstaltung" && alias.veranstaltung_id)
			eventByAlias.set(catalogKey(alias.schreibweise), alias.veranstaltung_id);
	}
	const personById = new Map(persons.map((person) => [person.id, person]));
	const eventById = new Map(events.map((event) => [event.id, event]));
	return {
		persons,
		events,
		/** Exact catalogue hit first, then a remembered spelling. */
		person(nachname: string, vorname: string) {
			const direct = personByName.get(personKey(nachname, vorname));
			if (direct) return direct;
			const aliased = personByAlias.get(catalogKey(`${nachname}, ${vorname}`));
			return aliased ? personById.get(aliased) : undefined;
		},
		event(name: string) {
			const direct = eventByName.get(catalogKey(name));
			if (direct) return direct;
			const aliased = eventByAlias.get(catalogKey(name));
			return aliased ? eventById.get(aliased) : undefined;
		},
	};
}

export type HelperHourResolver = Awaited<
	ReturnType<typeof loadHelperHourResolver>
>;
