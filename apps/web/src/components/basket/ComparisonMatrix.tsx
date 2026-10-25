import { useState } from "react";
import { Link } from "wouter";
import type {
  OrderPresentation,
  RetailerOption,
  SubmittedProduct,
} from "../../features/basket-comparison/model";
import { excludedPromotionNote, formatSgd, multibuyNotes } from "../../lib/format";
import WasPrice from "../WasPrice";

type Line = OrderPresentation["lines"][number];

/** The order a column prices: a complete option's, or an unavailable one's labelled partial estimate. */
const orderOf = (option: RetailerOption): OrderPresentation | undefined =>
  option.kind === "complete" ? option : option.partial;

/** One row per product, named once, in the order of the first option that has all of them. */
function productRows(options: RetailerOption[]): SubmittedProduct[] {
  const seen = new Map<string, SubmittedProduct>();
  // Keep the first entry that has an image: a retailer's missing-product entry may lack one.
  const add = (product: SubmittedProduct) => {
    if (!seen.get(product.productId)?.imageUrl) seen.set(product.productId, product);
  };
  for (const option of options) {
    for (const line of orderOf(option)?.lines ?? []) add(line);
    if (option.kind === "unavailable")
      for (const product of option.missingProducts ?? []) add(product);
  }
  return [...seen.values()];
}

/** The catalogue image, or a neutral placeholder when there is none or it fails to load. */
function Thumb({ product }: { product: SubmittedProduct }) {
  const [failed, setFailed] = useState(false);
  if (!product.imageUrl || failed) return <span className="matrix__thumb" aria-hidden />;
  return (
    <img
      className="matrix__thumb"
      src={product.imageUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function columnTitle(option: RetailerOption, recommended: boolean, tied: boolean) {
  if (option.kind === "complete")
    return recommended
      ? tied
        ? "Recommended — joint lowest estimated total"
        : "Recommended — lowest estimated total"
      : "Complete";
  if ((option.missingProducts?.length ?? 0) > 0) return "Incomplete basket";
  return option.explanations?.some(({ reason }) => reason.code === "below_minimum_order")
    ? "Below minimum order"
    : "Unavailable";
}

/** Notes can repeat, so a key is the text plus how many identical notes came before it. */
function withKeys(values: string[]) {
  const seen = new Map<string, number>();
  return values.map((value) => {
    const occurrence = seen.get(value) ?? 0;
    seen.set(value, occurrence + 1);
    return { value, key: `${value}:${occurrence}` };
  });
}

function Cell({
  line,
  retailerName,
  purchaseEnabled,
}: {
  line: Line;
  retailerName: string;
  purchaseEnabled: boolean;
}) {
  const notes = [
    ...line.pricing.itemCharges.map(
      (charge) =>
        `${charge.label}: ${formatSgd(charge.amountCents)} for this line${
          charge.includedInPrice
            ? " (included in unit price)"
            : " (additional charge, already included in line total)"
        }`,
    ),
    ...multibuyNotes(line.pricing.multibuy, line.quantity, line.pricing.unitPriceCents),
    ...line.pricing.excludedPromotions.map(excludedPromotionNote),
  ];
  return (
    <>
      <strong>{formatSgd(line.amountCents)}</strong>
      <span className="matrix__unit">
        {line.quantity} × <WasPrice cents={line.pricing.originalPriceCents} />
        {formatSgd(line.pricing.unitPriceCents)}
        {line.pricing.priceKind === "unconditional_sale" && " sale"}
      </span>
      {withKeys(notes).map(({ value, key }) => (
        <span key={key} className="matrix__note">
          {value}
        </span>
      ))}
      {purchaseEnabled && (
        <a href={line.purchaseUrl} target="_blank" rel="noopener noreferrer" className="text-link">
          View{" "}
          <span className="sr-only">
            {line.name} at {retailerName}
          </span>{" "}
          ↗
        </a>
      )}
    </>
  );
}

/**
 * The comparison as one table: each product named once, one price column per
 * retailer. Retailers that lack products show "Not available" in those cells
 * and a labelled partial estimate; they are never ranked or recommended.
 */
export default function ComparisonMatrix({
  options,
  recommendedId,
  tied,
  purchaseEnabled = true,
}: {
  options: RetailerOption[];
  recommendedId: string | null;
  tied: boolean;
  purchaseEnabled?: boolean;
}) {
  // Complete options always come first; a stable sort keeps the API's order otherwise (J3).
  const columns = [...options].sort(
    (a, b) => Number(a.kind === "unavailable") - Number(b.kind === "unavailable"),
  );
  const rows = productRows(columns);
  const charges = [
    ...new Set(columns.flatMap((o) => (orderOf(o)?.charges ?? []).map((c) => c.label))),
  ];
  type FootRow = {
    label: string;
    amount: (order: OrderPresentation) => number | undefined;
    total: boolean;
  };
  const footRows: FootRow[] = [
    { label: "Product subtotal", amount: (o) => o.productSubtotalCents, total: false },
    ...charges.map((label) => ({
      label,
      amount: (o: OrderPresentation) => o.charges.find((c) => c.label === label)?.amountCents,
      total: false,
    })),
    { label: "Estimated total", amount: (o) => o.estimatedTotalCents, total: true },
  ];
  return (
    <table className="matrix">
      <caption className="sr-only">Basket price by retailer</caption>
      <thead>
        <tr>
          <th scope="col" className="matrix__corner">
            {rows.length} {rows.length === 1 ? "product" : "products"}
          </th>
          {columns.map((option) => {
            const recommended = option.retailer.id === recommendedId;
            const order = orderOf(option);
            const missing =
              option.kind === "unavailable" ? (option.missingProducts?.length ?? 0) : 0;
            return (
              <th
                key={option.retailer.id}
                scope="col"
                className={`matrix__retailer${recommended ? " matrix__retailer--recommended" : ""}${option.kind === "unavailable" ? " matrix__retailer--muted" : ""}`}
              >
                <h2>{option.retailer.name}</h2>
                <span className="matrix__badge">{columnTitle(option, recommended, tied)}</span>
                <strong className="matrix__total">
                  {order ? formatSgd(order.estimatedTotalCents) : "No estimate"}
                </strong>
                {option.kind === "unavailable" && order && (
                  <span className="matrix__partial">
                    {missing > 0
                      ? `Estimated total for ${order.lines.length} of ${rows.length} items`
                      : "Estimated total"}
                  </span>
                )}
                {option.kind === "unavailable" &&
                  option.reasons.map((reason) => (
                    <span key={reason} className="matrix__reason">
                      {reason}
                    </span>
                  ))}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((product) => (
          <tr key={product.productId}>
            <th scope="row" className="matrix__product">
              <div className="matrix__identity">
                <Thumb product={product} />
                <div>
                  <Link className="matrix__name" href={`/product/${product.productId}`}>
                    {product.name}
                  </Link>
                  <span>
                    {product.packDescription} · {product.quantity}{" "}
                    {product.quantity === 1 ? "pack" : "packs"}
                  </span>
                </div>
              </div>
            </th>
            {columns.map((option) => {
              const line = orderOf(option)?.lines.find((l) => l.productId === product.productId);
              return (
                <td
                  key={option.retailer.id}
                  className={`matrix__cell${option.retailer.id === recommendedId ? " matrix__cell--recommended" : ""}${line ? "" : " matrix__cell--missing"}`}
                  data-retailer={option.retailer.name}
                >
                  {line ? (
                    <Cell
                      line={line}
                      retailerName={option.retailer.name}
                      purchaseEnabled={purchaseEnabled}
                    />
                  ) : (
                    <span>Not available</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        {footRows.map(({ label, amount, total }) => (
          <tr key={label} className={total ? "matrix__total-row" : undefined}>
            <th scope="row">{label}</th>
            {columns.map((option) => {
              const order = orderOf(option);
              const cents = order && amount(order);
              return (
                <td key={option.retailer.id} data-retailer={option.retailer.name}>
                  {cents === undefined ? "—" : formatSgd(cents)}
                  {cents !== undefined && option.kind === "unavailable" && (
                    <span className="matrix__partial"> (partial estimate)</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tfoot>
    </table>
  );
}
