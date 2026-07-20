CREATE TABLE "member_profile" (
	"member_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"can_coach" boolean DEFAULT false NOT NULL,
	"notes" text,
	"tags" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_profile_org_status_idx" ON "member_profile" USING btree ("organization_id","status");