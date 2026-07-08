CREATE TABLE "org_profile" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"description" text,
	"sports" text[],
	"contact_email" text,
	"contact_phone" text,
	"website_url" text,
	"instagram_url" text,
	"facebook_url" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"postal_code" text,
	"country" text,
	"timezone" text,
	"locale" text,
	"currency" text,
	"legal_name" text,
	"tax_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_profile" ADD CONSTRAINT "org_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;