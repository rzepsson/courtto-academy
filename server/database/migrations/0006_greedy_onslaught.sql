CREATE TABLE "attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"student_member_id" text NOT NULL,
	"status" text NOT NULL,
	"marked_by" text,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"student_member_id" text NOT NULL,
	"series_id" text,
	"session_id" text,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"waitlist_pos" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_target_chk" CHECK ((("series_id" is not null)::int + ("session_id" is not null)::int) = 1)
);
--> statement-breakpoint
CREATE TABLE "lesson_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"series_id" text NOT NULL,
	"occurrence_start" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"session_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_series" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"sport" text NOT NULL,
	"title" text NOT NULL,
	"color" text NOT NULL,
	"level" text,
	"age_group" text,
	"notes" text,
	"coach_member_id" text,
	"assistant_coach_member_id" text,
	"default_court_id" text,
	"timezone" text NOT NULL,
	"rrule" text,
	"dt_start" text NOT NULL,
	"duration_min" integer NOT NULL,
	"capacity_min" integer,
	"capacity_max" integer,
	"enrollment_open" boolean DEFAULT true NOT NULL,
	"enrollment_deadline_min" integer,
	"visibility" text DEFAULT 'members' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"materialized_until" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"series_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"occurrence_start" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"coach_member_id" text,
	"court_id" text,
	"capacity_max" integer,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cancel_reason" text,
	"overridden" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"court_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"kind" text DEFAULT 'blocked' NOT NULL,
	"title" text,
	"note" text,
	"booked_by_type" text,
	"booked_by_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_time_order_chk" CHECK ("reservation"."ends_at" > "reservation"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_lesson_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_member_id_member_id_fk" FOREIGN KEY ("student_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_member_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_member_id_member_id_fk" FOREIGN KEY ("student_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_series_id_lesson_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."lesson_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_session_id_lesson_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_exception" ADD CONSTRAINT "lesson_exception_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_exception" ADD CONSTRAINT "lesson_exception_series_id_lesson_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."lesson_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_exception" ADD CONSTRAINT "lesson_exception_session_id_lesson_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series" ADD CONSTRAINT "lesson_series_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series" ADD CONSTRAINT "lesson_series_coach_member_id_member_id_fk" FOREIGN KEY ("coach_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series" ADD CONSTRAINT "lesson_series_assistant_coach_member_id_member_id_fk" FOREIGN KEY ("assistant_coach_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series" ADD CONSTRAINT "lesson_series_default_court_id_court_id_fk" FOREIGN KEY ("default_court_id") REFERENCES "public"."court"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_series" ADD CONSTRAINT "lesson_series_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD CONSTRAINT "lesson_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD CONSTRAINT "lesson_session_series_id_lesson_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."lesson_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD CONSTRAINT "lesson_session_reservation_id_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD CONSTRAINT "lesson_session_coach_member_id_member_id_fk" FOREIGN KEY ("coach_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_session" ADD CONSTRAINT "lesson_session_court_id_court_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."court"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_court_id_court_id_fk" FOREIGN KEY ("court_id") REFERENCES "public"."court"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_session_idx" ON "attendance" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "attendance_student_idx" ON "attendance" USING btree ("student_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_session_student_uidx" ON "attendance" USING btree ("session_id","student_member_id");--> statement-breakpoint
CREATE INDEX "enrollment_series_idx" ON "enrollment" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "enrollment_session_idx" ON "enrollment" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "enrollment_student_idx" ON "enrollment" USING btree ("student_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_series_student_uidx" ON "enrollment" USING btree ("series_id","student_member_id") WHERE "enrollment"."series_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_session_student_uidx" ON "enrollment" USING btree ("session_id","student_member_id") WHERE "enrollment"."session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_exception_series_occurrence_uidx" ON "lesson_exception" USING btree ("series_id","occurrence_start");--> statement-breakpoint
CREATE INDEX "lesson_series_org_idx" ON "lesson_series" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "lesson_series_coach_idx" ON "lesson_series" USING btree ("coach_member_id");--> statement-breakpoint
CREATE INDEX "lesson_session_org_starts_idx" ON "lesson_session" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "lesson_session_series_idx" ON "lesson_session" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "lesson_session_coach_starts_idx" ON "lesson_session" USING btree ("coach_member_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_session_series_occurrence_uidx" ON "lesson_session" USING btree ("series_id","occurrence_start");--> statement-breakpoint
CREATE INDEX "reservation_org_starts_idx" ON "reservation" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "reservation_court_starts_idx" ON "reservation" USING btree ("court_id","starts_at");--> statement-breakpoint
-- Hand-added (Drizzle can't express EXCLUDE). Hard, race-safe guarantee that no
-- two non-cancelled reservations for the same court overlap in time. Operates on
-- the half-open range [starts_at, ends_at), matching rangesOverlap in
-- shared/reservation.ts. btree_gist provides the `=` operator class for court_id.
-- The reservation_time_order_chk CHECK above keeps the tstzrange non-empty, so
-- the overlap test can never be silently defeated by a zero-length interval.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_no_court_overlap" EXCLUDE USING gist ("court_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" <> 'cancelled');