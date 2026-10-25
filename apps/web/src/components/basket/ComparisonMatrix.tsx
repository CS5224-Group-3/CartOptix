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
  return (option.missingProducts?.length ?? 0) > 0 ? "Incomplete basket" : "Unavailable";
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
      {notes.map((note) => (
        <span key={note} className="matrix__note">
          {note}
        </span>
      ))}
      {purchaseEnabled && (
        <a href={line.purchaseUrl} target="_blank" rel="noopener noreferrer" className="text-link">
          View
          <span className="sr-only">
            {" "}
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
  const rows = productRows(options);
  const columns = options.length;
  const style = { "--matrix-columns": columns } as React.CSSProperties;
  return (
    <div className="matrix" style={style}>
      <div className="matrix__head" role="presentation">
        <div className="matrix__corner">
          {rows.length} {rows.length === 1 ? "product" : "products"}
        </div>
        {options.map((option) => {
          const recommended = option.retailer.id === recommendedId;
          const order = orderOf(option);
          const missing = option.kind === "unavailable" ? (option.missingProducts?.length ?? 0) : 0;
          return (
            <div
              key={option.retailer.id}
              className={`matrix__retailer${recommended ? " matrix__retailer--recommended" : ""}${option.kind === "unavailable" ? " matrix__retailer--muted" : ""}`}
            >
              <h2>{option.retailer.name}</h2>
              <span className="matrix__badge">{columnTitle(option, recommended, tied)}</span>
              <strong className="matrix__total">
                {order ? formatSgd(order.estimatedTotalCents) : "No estimate"}
              </strong>
              {order && missing > 0 && (
                <span className="matrix__partial">
                  for {order.lines.length} of {rows.length} items
                </span>
              )}
              {option.kind === "unavailable" &&
                option.reasons.map((reason) => (
                  <span key={reason} className="matrix__reason">
                    {reason}
                  </span>
                ))}
            </div>
          );
        })}
      </div>
      <ul className="matrix__rows">
        {rows.map((product) => (
          <li key={product.productId} className="matrix__row">
            <div className="matrix__product">
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
            {options.map((option) => {
              const line = orderOf(option)?.lines.find((l) => l.productId === product.productId);
              return (
                <div
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
                </div>
              );
            })}
          </li>
        ))}
      </ul>
      <dl className="matrix__foot">
        {(
          [
            ["Product subtotal", (o: OrderPresentation) => o.productSubtotalCents],
            ["Delivery", (o: OrderPresentation) => o.deliveryCents],
          ] as const
        ).map(([label, amount]) => (
          <div key={label} className="matrix__row">
            <dt>{label}</dt>
            {options.map((option) => {
              const order = orderOf(option);
              return (
                <dd key={option.retailer.id} data-retailer={option.retailer.name}>
                  {order ? formatSgd(amount(order)) : "—"}
                </dd>
              );
            })}
          </div>
        ))}
        {[...new Set(options.flatMap((o) => (orderOf(o)?.charges ?? []).map((c) => c.label)))].map(
          (label) => (
            <div key={label} className="matrix__row">
              <dt>{label}</dt>
              {options.map((option) => {
                const charge = orderOf(option)?.charges.find((c) => c.label === label);
                return (
                  <dd key={option.retailer.id} data-retailer={option.retailer.name}>
                    {charge ? formatSgd(charge.amountCents) : "—"}
                  </dd>
                );
              })}
            </div>
          ),
        )}
        <div className="matrix__row matrix__row--total">
          <dt>Estimated total</dt>
          {options.map((option) => {
            const order = orderOf(option);
            return (
              <dd key={option.retailer.id} data-retailer={option.retailer.name}>
                {order ? formatSgd(order.estimatedTotalCents) : "—"}
              </dd>
            );
          })}
        </div>
      </dl>
    </div>
  );
}
