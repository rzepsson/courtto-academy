CREATE TABLE "payment_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_member_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"enrollment_id" text,
	"student_name" text,
	"amount_minor" integer,
	"currency" text,
	"stripe_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_audit" ADD CONSTRAINT "payment_audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_audit_org_created_idx" ON "payment_audit" USING btree ("organization_id","created_at");