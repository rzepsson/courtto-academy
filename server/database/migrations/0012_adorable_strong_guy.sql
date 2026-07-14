CREATE TABLE "court_zone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "court" ADD COLUMN "zone_id" text;--> statement-breakpoint
ALTER TABLE "court_zone" ADD CONSTRAINT "court_zone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_zone" ADD CONSTRAINT "court_zone_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "court_zone_org_sort_idx" ON "court_zone" USING btree ("organization_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "court_zone_org_name_uidx" ON "court_zone" USING btree ("organization_id",lower("name"));--> statement-breakpoint
ALTER TABLE "court" ADD CONSTRAINT "court_zone_id_court_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."court_zone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill (expand phase): promote the legacy free-text court.zone into first-class
-- court_zone rows — one per distinct case-insensitive name per facility — then link
-- each court. The `zone` column itself is dropped by the contract migration 0013.
INSERT INTO "court_zone" ("id", "organization_id", "name", "sort_order", "created_at", "updated_at")
SELECT gen_random_uuid()::text, dz."organization_id", dz."zone",
	(row_number() OVER (PARTITION BY dz."organization_id" ORDER BY lower(dz."zone"))) - 1,
	now(), now()
FROM (
	SELECT DISTINCT ON ("organization_id", lower(btrim("zone"))) "organization_id", btrim("zone") AS "zone"
	FROM "court"
	WHERE "zone" IS NOT NULL AND btrim("zone") <> ''
	ORDER BY "organization_id", lower(btrim("zone")), btrim("zone")
) dz;--> statement-breakpoint
UPDATE "court" c SET "zone_id" = z."id"
FROM "court_zone" z
WHERE z."organization_id" = c."organization_id" AND lower(z."name") = lower(btrim(c."zone"));