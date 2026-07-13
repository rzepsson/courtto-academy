ALTER TABLE "lesson_series" DROP CONSTRAINT "lesson_series_coach_member_id_member_id_fk";
--> statement-breakpoint
ALTER TABLE "lesson_series" DROP CONSTRAINT "lesson_series_default_court_id_court_id_fk";
--> statement-breakpoint
DROP INDEX "lesson_series_coach_idx";--> statement-breakpoint
DROP INDEX "lesson_series_materialization_idx";--> statement-breakpoint
ALTER TABLE "lesson_series" DROP COLUMN "coach_member_id";--> statement-breakpoint
ALTER TABLE "lesson_series" DROP COLUMN "default_court_id";--> statement-breakpoint
ALTER TABLE "lesson_series" DROP COLUMN "rrule";--> statement-breakpoint
ALTER TABLE "lesson_series" DROP COLUMN "dt_start";--> statement-breakpoint
ALTER TABLE "lesson_series" DROP COLUMN "duration_min";--> statement-breakpoint
ALTER TABLE "lesson_series" DROP COLUMN "materialized_until";