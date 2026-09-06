CREATE TABLE "helper_hour_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" text NOT NULL,
	"schreibweise" text NOT NULL,
	"person_id" uuid,
	"veranstaltung_id" uuid,
	"erstellt_von_user_id" text NOT NULL,
	"erstellt_von_name" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helper_hour_aliases_art_check" CHECK ("helper_hour_aliases"."art" IN ('person', 'veranstaltung')),
	CONSTRAINT "helper_hour_aliases_spelling_check" CHECK (length(trim("helper_hour_aliases"."schreibweise")) BETWEEN 1 AND 250),
	CONSTRAINT "helper_hour_aliases_target_check" CHECK (("helper_hour_aliases"."art" = 'person' AND "helper_hour_aliases"."person_id" IS NOT NULL AND "helper_hour_aliases"."veranstaltung_id" IS NULL) OR ("helper_hour_aliases"."art" = 'veranstaltung' AND "helper_hour_aliases"."veranstaltung_id" IS NOT NULL AND "helper_hour_aliases"."person_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "helper_hour_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_von_user_id" text,
	"erstellt_von_name" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helper_hour_events_name_check" CHECK (length(trim("helper_hour_events"."name")) BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE TABLE "helper_hour_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nachname" text NOT NULL,
	"vorname" text NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_von_user_id" text,
	"erstellt_von_name" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helper_hour_persons_name_check" CHECK (length(trim("helper_hour_persons"."nachname")) BETWEEN 1 AND 120 AND length(trim("helper_hour_persons"."vorname")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "helper_hours" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "helper_hours" ADD COLUMN "veranstaltung_id" uuid;--> statement-breakpoint
ALTER TABLE "helper_hour_aliases" ADD CONSTRAINT "helper_hour_aliases_person_id_helper_hour_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."helper_hour_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_hour_aliases" ADD CONSTRAINT "helper_hour_aliases_veranstaltung_id_helper_hour_events_id_fk" FOREIGN KEY ("veranstaltung_id") REFERENCES "public"."helper_hour_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helper_hour_aliases_unique" ON "helper_hour_aliases" USING btree ("art",lower(trim("schreibweise")));--> statement-breakpoint
CREATE UNIQUE INDEX "helper_hour_events_name_unique" ON "helper_hour_events" USING btree (lower(trim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "helper_hour_persons_name_unique" ON "helper_hour_persons" USING btree (lower(trim("nachname")),lower(trim("vorname")));--> statement-breakpoint
CREATE INDEX "idx_helper_hour_persons_sort" ON "helper_hour_persons" USING btree ("nachname","vorname");--> statement-breakpoint
ALTER TABLE "helper_hours" ADD CONSTRAINT "helper_hours_person_id_helper_hour_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."helper_hour_persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_hours" ADD CONSTRAINT "helper_hours_veranstaltung_id_helper_hour_events_id_fk" FOREIGN KEY ("veranstaltung_id") REFERENCES "public"."helper_hour_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_helper_hours_person" ON "helper_hours" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_helper_hours_event" ON "helper_hours" USING btree ("veranstaltung_id");--> statement-breakpoint
INSERT INTO "helper_hour_persons" ("nachname", "vorname")
SELECT DISTINCT ON (lower(trim("nachname")), lower(trim("vorname")))
	trim("nachname"), trim("vorname")
FROM "helper_hours"
WHERE length(trim("nachname")) > 0 AND length(trim("vorname")) > 0
ORDER BY lower(trim("nachname")), lower(trim("vorname")), trim("nachname"), trim("vorname")
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "helper_hour_events" ("name")
SELECT DISTINCT ON (lower(trim("veranstaltung"))) trim("veranstaltung")
FROM "helper_hours"
WHERE length(trim("veranstaltung")) > 0
ORDER BY lower(trim("veranstaltung")), trim("veranstaltung")
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "helper_hours" AS "h"
SET "person_id" = "p"."id"
FROM "helper_hour_persons" AS "p"
WHERE lower(trim("h"."nachname")) = lower(trim("p"."nachname"))
	AND lower(trim("h"."vorname")) = lower(trim("p"."vorname"))
	AND "h"."person_id" IS NULL;--> statement-breakpoint
UPDATE "helper_hours" AS "h"
SET "veranstaltung_id" = "e"."id"
FROM "helper_hour_events" AS "e"
WHERE lower(trim("h"."veranstaltung")) = lower(trim("e"."name"))
	AND "h"."veranstaltung_id" IS NULL;--> statement-breakpoint
DO $$
DECLARE
	"ohne_anlass" bigint;
	"ohne_person" bigint;
BEGIN
	SELECT count(*) INTO "ohne_anlass" FROM "helper_hours" WHERE "veranstaltung_id" IS NULL;
	IF "ohne_anlass" > 0 THEN
		RAISE EXCEPTION 'Helferstunden-Katalog: % Zeilen ohne zugeordnete Veranstaltung', "ohne_anlass";
	END IF;
	-- Zeilen ohne Namen sind Sammeleintraege und duerfen keine Person haben.
	SELECT count(*) INTO "ohne_person"
	FROM "helper_hours"
	WHERE "person_id" IS NULL
		AND length(trim("nachname")) > 0 AND length(trim("vorname")) > 0;
	IF "ohne_person" > 0 THEN
		RAISE EXCEPTION 'Helferstunden-Katalog: % benannte Zeilen ohne zugeordnete Person', "ohne_person";
	END IF;
END $$;
