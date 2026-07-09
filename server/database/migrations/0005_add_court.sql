CREATE TABLE "court" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"sport" text NOT NULL,
	"surface" text,
	"environment" text DEFAULT 'indoor' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"surface_color" text NOT NULL,
	"line_color" text DEFAULT '#ffffff' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"zone" text,
	"bookable" boolean DEFAULT false NOT NULL,
	"notes" text,
	"archived_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "court" ADD CONSTRAINT "court_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court" ADD CONSTRAINT "court_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "court_org_sort_idx" ON "court" USING btree ("organization_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "court_org_name_uidx" ON "court" USING btree ("organization_id",lower("name")) WHERE "court"."archived_at" is null;