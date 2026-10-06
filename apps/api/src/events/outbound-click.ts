import pg from "pg";

/**
 * Recording outbound clicks through to a retailer's product page (PR-07, #19).
 *
 * Three rules shape this file.
 *
 * *Nothing the caller says is trusted.* The request carries a listing ID and
 * nothing else. Retailer and product are read out of the matching listing row,
 * so an event cannot be attributed to a retailer of the caller's choosing and
 * an unknown listing records nothing.
 *
 * *Tracking must not slow basket comparison.* Click writes use their own small
 * pool rather than sharing the one comparisons depend on, so however many
 * clicks arrive, they cannot take a connection a comparison needed. When that
 * pool is busy the write is shed rather than queued.
 *
 * *A failure here is never the caller's problem.* Every error resolves to
 * `not_recorded` and is logged. The endpoint stays a best-effort side channel,
 * so a database hiccup cannot fail a shopper's navigation or count against the
 * service's error budget.
 */

export type ClickRecordResult =
  /** The event is stored. */
  | "recorded"
  /** No listing with that ID exists in the loaded seed; nothing was stored. */
  | "unknown-listing"
  /** Shed or failed. Expected under load, and never surfaced as an error. */
  | "not_recorded";

export interface ClickRecorder {
  record(listingId: string): Promise<ClickRecordResult>;
  close(): Promise<void>;
}

/**
 * Validates and stores in one statement.
 *
 * The insert selects its columns from the listing itself, so validation and
 * the write cannot disagree: no listing matches, no event is written, and
 * there is no window between the check and the insert for a seed import to
 * change the answer.
 */
const INSERT_EVENT = `
  INSERT INTO click_events (listing_id, retailer_id, product_id)
  SELECT listing_id, retailer_id, product_id
  FROM listings
  WHERE listing_id = $1
`;

export interface ClickRecorderOptions {
  connectionString: string;
  /**
   * Connections reserved for click writes.
   *
   * Small on purpose. Clicks are a reporting side channel, and this is the
   * ceiling on what they can ever take from PostgreSQL.
   */
  maxConnections?: number;
  /** Logs a shed or failed write. Replaced in tests. */
  onFailure?: (reason: string) => void;
}

export function createClickRecorder({
  connectionString,
  maxConnections = 2,
  onFailure = (reason) => console.warn(`Outbound click not recorded: ${reason}`),
}: ClickRecorderOptions): ClickRecorder {
  const pool = new pg.Pool({
    connectionString,
    max: maxConnections,
    // Shed rather than queue. A click that waits is worth less than a
    // comparison that does not, and an unbounded queue would outlive the
    // navigation that produced it.
    connectionTimeoutMillis: 250,
    // A click write is a single indexed insert; anything slower is a fault.
    statement_timeout: 1000,
  });

  pool.on("error", (error) => {
    onFailure(`idle connection failed: ${error.message}`);
  });

  return {
    async record(listingId: string): Promise<ClickRecordResult> {
      try {
        const result = await pool.query(INSERT_EVENT, [listingId]);
        return result.rowCount === 1 ? "recorded" : "unknown-listing";
      } catch (error) {
        onFailure(error instanceof Error ? error.message : "unknown error");
        return "not_recorded";
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
