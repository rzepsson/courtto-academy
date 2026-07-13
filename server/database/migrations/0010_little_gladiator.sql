DROP INDEX "lesson_exception_series_occurrence_uidx";--> statement-breakpoint
DROP INDEX "lesson_exception_rule_idx";--> statement-breakpoint
DROP INDEX "lesson_session_series_occurrence_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_exception_rule_occurrence_uidx" ON "lesson_exception" USING btree ("rule_id","occurrence_start");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_session_rule_occurrence_uidx" ON "lesson_session" USING btree ("rule_id","occurrence_start");