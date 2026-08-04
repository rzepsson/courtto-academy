CREATE TABLE "enrollment_billing" (
	"enrollment_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"checkout_session_id" text,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_series" ADD COLUMN "pricing_plan_id" text;--> statement-breakpoint
ALTER TABLE "member_guardian" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "member_profile" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "enrollment_billing" ADD CONSTRAINT "enrollment_billing_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_billing" ADD CONSTRAINT "enrollment_billing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollment_billing_org_idx" ON "enrollment_billing" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "enrollment_billing_subscription_idx" ON "enrollment_billing" USING btree ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "lesson_series" ADD CONSTRAINT "lesson_series_pricing_plan_id_pricing_plan_id_fk" FOREIGN KEY ("pricing_plan_id") REFERENCES "public"."pricing_plan"("id") ON DELETE set null ON UPDATE no action;