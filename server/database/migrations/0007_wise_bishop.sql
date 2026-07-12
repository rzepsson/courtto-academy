CREATE INDEX "lesson_series_materialization_idx" ON "lesson_series" USING btree ("materialized_until") WHERE "lesson_series"."rrule" is not null;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD CONSTRAINT "lesson_session_time_order_chk" CHECK ("lesson_session"."ends_at" > "lesson_session"."starts_at");--> statement-breakpoint
-- Hand-added (Drizzle can't express EXCLUDE). Hard, race-safe guarantee that one
-- coach is never assigned to two overlapping non-cancelled sessions — the check
-- a single-court EXCLUDE on `reservation` can't span (a coach clash crosses
-- courts). Operates on the half-open range [starts_at, ends_at) on the session's
-- DENORMALIZED coach/time columns, so no join back to the series is needed.
-- btree_gist (created in 0006) provides the `=` operator class for coach_member_id;
-- the lesson_session_time_order_chk CHECK above keeps the tstzrange non-empty.
-- The WHERE skips coach-less sessions (open-court blocks) and cancelled ones (the
-- service frees a coach by flipping status to 'cancelled', mirroring the court EXCLUDE).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD CONSTRAINT "lesson_session_no_coach_overlap" EXCLUDE USING gist ("coach_member_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("coach_member_id" IS NOT NULL AND "status" <> 'cancelled');