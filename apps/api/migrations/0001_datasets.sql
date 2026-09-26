-- Curated seed datasets (#4). Every row belongs to one imported dataset, so a new
-- import loads beside the active one and activation is a single flag change.
-- IDs are the seed's stable IDs and repeat across datasets.

CREATE DOMAIN seed_id AS text
  CHECK (VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$');

CREATE DOMAIN https_url AS text
  CHECK (VALUE ~ '^https://' AND length(VALUE) <= 2048);

CREATE TABLE datasets (
  dataset_id seed_id PRIMARY KEY,
  data_kind text NOT NULL CHECK (data_kind IN ('curated', 'synthetic')),
  schema_version integer NOT NULL,
  seed_checksum text NOT NULL CHECK (seed_checksum ~ '^[0-9a-f]{64}$'),
  delivery_scenario text NOT NULL CHECK (delivery_scenario <> ''),
  -- When the row was loaded. Not a collection date, and never shown to shoppers.
  imported_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT false
);

-- At most one active dataset.
CREATE UNIQUE INDEX datasets_one_active ON datasets (is_active) WHERE is_active;

CREATE TABLE retailers (
  dataset_id seed_id NOT NULL REFERENCES datasets ON DELETE CASCADE,
  retailer_id text NOT NULL CHECK (retailer_id IN ('redmart', 'fairprice', 'cold-storage')),
  name text NOT NULL CHECK (name <> ''),
  product_url_hosts text[] NOT NULL CHECK (cardinality(product_url_hosts) > 0),
  PRIMARY KEY (dataset_id, retailer_id)
);

CREATE TABLE categories (
  dataset_id seed_id NOT NULL REFERENCES datasets ON DELETE CASCADE,
  category_id seed_id NOT NULL,
  name text NOT NULL CHECK (name <> ''),
  PRIMARY KEY (dataset_id, category_id)
);

-- One rule per retailer for the dataset's declared scenario. Unknown values stay
-- NULL under 'unverified' rather than becoming zero.
CREATE TABLE delivery_rules (
  dataset_id seed_id NOT NULL,
  retailer_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('verified', 'unverified')),
  delivery_fee_cents integer CHECK (delivery_fee_cents >= 0),
  free_delivery_from_cents integer CHECK (free_delivery_from_cents >= 0),
  minimum_order_cents integer CHECK (minimum_order_cents >= 0),
  threshold_includes_mandatory_charges boolean,
  note text,
  sources https_url[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (dataset_id, retailer_id),
  FOREIGN KEY (dataset_id, retailer_id) REFERENCES retailers ON DELETE CASCADE,
  CHECK (
    status = 'unverified'
    OR (delivery_fee_cents IS NOT NULL
        AND threshold_includes_mandatory_charges IS NOT NULL
        AND note IS NOT NULL AND note <> '')
  )
);

CREATE TABLE order_charges (
  dataset_id seed_id NOT NULL,
  retailer_id text NOT NULL,
  label text NOT NULL CHECK (label <> ''),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (dataset_id, retailer_id, label),
  FOREIGN KEY (dataset_id, retailer_id) REFERENCES delivery_rules ON DELETE CASCADE
);

CREATE TABLE products (
  dataset_id seed_id NOT NULL,
  product_id seed_id NOT NULL,
  category_id seed_id NOT NULL,
  representative_name text NOT NULL CHECK (representative_name <> ''),
  image_url https_url,
  PRIMARY KEY (dataset_id, product_id),
  FOREIGN KEY (dataset_id, category_id) REFERENCES categories ON DELETE CASCADE
);

-- A published listing always carries its eligible offer: in stock, directly
-- fulfilled, with a positive ordinary or unconditional sale price.
CREATE TABLE listings (
  dataset_id seed_id NOT NULL,
  listing_id seed_id NOT NULL,
  product_id seed_id NOT NULL,
  retailer_id text NOT NULL,
  source_record_id text NOT NULL CHECK (source_record_id <> ''),
  name text NOT NULL CHECK (name <> ''),
  specification text NOT NULL CHECK (specification <> ''),
  product_url https_url NOT NULL,
  price_kind text NOT NULL CHECK (price_kind IN ('ordinary', 'unconditional_sale')),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  excluded_promotions text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (dataset_id, listing_id),
  -- An exact product is listed at most once per retailer.
  UNIQUE (dataset_id, product_id, retailer_id),
  FOREIGN KEY (dataset_id, product_id) REFERENCES products ON DELETE CASCADE,
  FOREIGN KEY (dataset_id, retailer_id) REFERENCES retailers ON DELETE CASCADE
);
