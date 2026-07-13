CREATE TABLE "lesson_series_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"series_id" text NOT NULL,
	"rrule" text,
	"dt_start" text NOT NULL,
	"duration_min" integer NOT NULL,
	"timezone" text NOT NULL,
	"court_id" text,
	"coach_member_id" text,
	"materialized_until" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_exception" ADD COLUMN "rule_id" text;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD COLUMN "rule_id" text;--> statement-breakpoint
ALTER TABLE "lesson_series_rule" ADD CONSTRAINT "lesson_series_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series_rule" ADD CONSTRAINT "lesson_series_rule_series_id_lesson_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."lesson_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series_rule" ADD CONSTRAINT "lesson_series_rule_court_id_court_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."court"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series_rule" ADD CONSTRAINT "lesson_series_rule_coach_member_id_member_id_fk" FOREIGN KEY ("coach_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_series_rule_org_idx" ON "lesson_series_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "lesson_series_rule_series_idx" ON "lesson_series_rule" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "lesson_series_rule_materialization_idx" ON "lesson_series_rule" USING btree ("materialized_until") WHERE "lesson_series_rule"."rrule" is not null;--> statement-breakpoint
ALTER TABLE "lesson_exception" ADD CONSTRAINT "lesson_exception_rule_id_lesson_series_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."lesson_series_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD CONSTRAINT "lesson_session_rule_id_lesson_series_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."lesson_series_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_exception_rule_idx" ON "lesson_exception" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "lesson_session_rule_idx" ON "lesson_session" USING btree ("rule_id");--> statement-breakpoint
-- Data backfill (expand phase). Every existing series becomes a group with ONE
-- rule carrying its current schedule + resources; sessions/exceptions are linked
-- to it. After this, each series has exactly one rule (1:1), so the joins below
-- are unambiguous. gen_random_uuid() is core Postgres (≥13); ids are stored as
-- text to match the app's randomUUID() ids.
INSERT INTO "lesson_series_rule" ("id", "organization_id", "series_id", "rrule", "dt_start", "duration_min", "timezone", "court_id", "coach_member_id", "materialized_until", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "organization_id", "id", "rrule", "dt_start", "duration_min", "timezone", "default_court_id", "coach_member_id", "materialized_until", now(), now()
FROM "lesson_series";--> statement-breakpoint
UPDATE "lesson_session" AS s SET "rule_id" = r."id"
FROM "lesson_series_rule" AS r WHERE r."series_id" = s."series_id";--> statement-breakpoint
UPDATE "lesson_exception" AS e SET "rule_id" = r."id"
FROM "lesson_series_rule" AS r WHERE r."series_id" = e."series_id";