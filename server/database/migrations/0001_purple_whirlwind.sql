CREATE TABLE "org_join_code" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "org_join_code_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "org_join_code" ADD CONSTRAINT "org_join_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_join_code" ADD CONSTRAINT "org_join_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_join_code_code_idx" ON "org_join_code" USING btree ("code");