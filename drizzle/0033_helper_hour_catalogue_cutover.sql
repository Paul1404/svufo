ALTER TABLE "helper_hour_name_aliases" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "helper_hour_name_aliases" CASCADE;--> statement-breakpoint
ALTER TABLE "helper_hours" DROP CONSTRAINT "helper_hours_name_check";--> statement-breakpoint
ALTER TABLE "helper_hours" ALTER COLUMN "veranstaltung_id" SET NOT NULL;