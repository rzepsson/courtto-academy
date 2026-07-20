CREATE TABLE "member_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"granted_at" timestamp,
	"withdrawn_at" timestamp,
	"granted_by_name" text,
	"guardian_id" text,
	"document_version" text,
	"notes" text,
	"recorded_by_member_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_consent" ADD CONSTRAINT "member_consent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_consent" ADD CONSTRAINT "member_consent_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_consent" ADD CONSTRAINT "member_consent_guardian_id_member_guardian_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."member_guardian"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_consent_member_type_uidx" ON "member_consent" USING btree ("member_id","type");--> statement-breakpoint
CREATE INDEX "member_consent_org_type_idx" ON "member_consent" USING btree ("organization_id","type");