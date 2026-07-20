CREATE TABLE "member_guardian" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_profile" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "member_guardian" ADD CONSTRAINT "member_guardian_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_guardian" ADD CONSTRAINT "member_guardian_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_guardian_member_idx" ON "member_guardian" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_guardian_primary_uidx" ON "member_guardian" USING btree ("member_id") WHERE "member_guardian"."is_primary";