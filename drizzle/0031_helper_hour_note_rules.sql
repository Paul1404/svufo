CREATE TABLE "helper_hour_note_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vermerk" text NOT NULL,
	"kategorie_id" uuid NOT NULL,
	"bemerkung" text DEFAULT '' NOT NULL,
	"erstellt_von_user_id" text NOT NULL,
	"erstellt_von_name" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helper_hour_note_rules_vermerk_check" CHECK (length(trim("helper_hour_note_rules"."vermerk")) BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "helper_hour_note_rules" ADD CONSTRAINT "helper_hour_note_rules_kategorie_id_helper_hour_categories_id_fk" FOREIGN KEY ("kategorie_id") REFERENCES "public"."helper_hour_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helper_hour_note_rules_vermerk_unique" ON "helper_hour_note_rules" USING btree (lower(trim("vermerk")));