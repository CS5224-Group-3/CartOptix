-- Curated seed datasets (#4). Every row belongs to one imported dataset, so a new
-- import loads beside the active one and activation is a single flag change.
-- IDs are the seed's stable IDs and repeat across datasets.
--
-- Value rules (ID format, https links, positive prices, allowed kinds) are
-- enforced by the importer's validation (apps/api/src/seed/validate.ts). The
-- schema keeps only keys, references and the single active dataset.

CREATE TABLE datasets (
  dataset_id text PRIMARY KEY,
  data_kind text NOT NULL,
  schema_version integer NOT NULL,
  seed_checksum text NOT NULL,
  delivery_scenario text NOT NULL,
  -- When the row was loaded. Not a collection date, and never shown to shoppers.
  imported_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT false
);

-- At most one active dataset.
CREATE UNIQUE INDEX datasets_one_active ON datasets (is_active) WHERE is_active;

CREATE TABLE retailers (
  dataset_id text NOT NULL REFERENCES datasets ON DELETE CASCADE,
  retailer_id text NOT NULL,
  name text NOT NULL,
  product_url_hosts text[] NOT NULL,
  PRIMARY KEY (dataset_id, retailer_id)
);

CREATE TABLE categories (
  dataset_id text NOT NULL REFERENCES datasets ON DELETE CASCADE,
  category_id text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (dataset_id, category_id)
);

-- One rule per retailer for the dataset's declared scenario. Values are NULL
-- when the rule is unverified, never zero.
CREATE TABLE delivery_rules (
  dataset_id text NOT NULL,
  retailer_id text NOT NULL,
  status text NOT NULL,
  delivery_fee_cents integer,
  free_delivery_from_cents integer,
  minimum_order_cents integer,
  threshold_includes_mandatory_charges boolean,
  note text,
  sources text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (dataset_id, retailer_id),
  FOREIGN KEY (dataset_id, retailer_id) REFERENCES retailers ON DELETE CASCADE
);

CREATE TABLE order_charges (
  dataset_id text NOT NULL,
  retailer_id text NOT NULL,
  label text NOT NULL,
  amount_cents integer NOT NULL,
  PRIMARY KEY (dataset_id, retailer_id, label),
  FOREIGN KEY (dataset_id, retailer_id) REFERENCES delivery_rules ON DELETE CASCADE
);

CREATE TABLE products (
  dataset_id text NOT NULL,
  product_id text NOT NULL,
  category_id text NOT NULL,
  representative_name text NOT NULL,
  image_url text,
  PRIMARY KEY (dataset_id, product_id),
  FOREIGN KEY (dataset_id, category_id) REFERENCES categories ON DELETE CASCADE
);

-- A published listing always carries its eligible offer.
CREATE TABLE listings (
  dataset_id text NOT NULL,
  listing_id text NOT NULL,
  product_id text NOT NULL,
  retailer_id text NOT NULL,
  source_record_id text NOT NULL,
  name text NOT NULL,
  specification text NOT NULL,
  product_url text NOT NULL,
  price_kind text NOT NULL,
  unit_price_cents integer NOT NULL,
  excluded_promotions text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (dataset_id, listing_id),
  FOREIGN KEY (dataset_id, product_id) REFERENCES products ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, retailer_id) REFERENCES retailers ON DELETE CASCADE
);
