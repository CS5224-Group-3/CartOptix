import { formatSgd } from "../lib/format";

/** A sale's pre-sale price, struck through. Display only; totals never use it. */
export default function WasPrice({ cents }: { cents: number | null }) {
  if (cents === null) return null;
  return (
    <>
      <s className="was-price">
        <span className="sr-only">Was </span>
        {formatSgd(cents)}
      </s>{" "}
    </>
  );
}
