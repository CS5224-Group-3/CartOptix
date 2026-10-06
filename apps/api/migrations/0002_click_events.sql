CREATE TABLE "click_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "click_events_occurred_at" ON "click_events" USING btree ("occurred_at");