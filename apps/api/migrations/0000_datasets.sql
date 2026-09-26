CREATE TABLE "categories" (
	"category_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset" (
	"dataset_id" text PRIMARY KEY NOT NULL,
	"data_kind" text NOT NULL,
	"schema_version" integer NOT NULL,
	"seed_checksum" text NOT NULL,
	"delivery_scenario" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_rules" (
	"retailer_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"delivery_fee_cents" integer,
	"free_delivery_from_cents" integer,
	"minimum_order_cents" integer,
	"threshold_includes_mandatory_charges" boolean,
	"note" text,
	"sources" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"listing_id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	"name" text NOT NULL,
	"specification" text NOT NULL,
	"product_url" text NOT NULL,
	"price_kind" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"excluded_promotions" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "listings_product_retailer" UNIQUE("product_id","retailer_id")
);
--> statement-breakpoint
CREATE TABLE "order_charges" (
	"retailer_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "order_charges_retailer_id_label_pk" PRIMARY KEY("retailer_id","label")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"product_id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"representative_name" text NOT NULL,
	"image_url" text
);
--> statement-breakpoint
CREATE TABLE "retailers" (
	"retailer_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"product_url_hosts" text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_rules" ADD CONSTRAINT "delivery_rules_retailer_id_retailers_retailer_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("retailer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_retailer_id_retailers_retailer_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("retailer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_charges" ADD CONSTRAINT "order_charges_retailer_id_delivery_rules_retailer_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."delivery_rules"("retailer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;