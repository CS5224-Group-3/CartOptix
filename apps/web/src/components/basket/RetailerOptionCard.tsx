import { useState } from "react";
import { Link } from "wouter";
import type {
  OrderPresentation,
  RetailerOption,
  SubmittedProduct,
  UnavailableRetailerOption,
} from "../../features/basket-comparison/model";
import { excludedPromotionNote, formatSgd, multibuyNotes } from "../../lib/format";
import WasPrice from "../WasPrice";

/** The contract has no charge/note IDs and permits repeated labels. Preserve every entry. */
function detailEntries<T>(values: T[]) {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const content = JSON.stringify(value);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { value, key: `${content}:${occurrence}` };
  });
}

export default function RetailerOptionCard({
  option,
  recommended,
  tied,
  purchaseEnabled = true,
}: {
  option: RetailerOption;
  recommended: boolean;
  tied: boolean;
  purchaseEnabled?: boolean;
}) {
  const highlighted = option.kind === "complete" && recommended;
  const name = option.retailer.name;
  return (
    <article
      className={`order-card retailer-option ${highlighted ? "retailer-option--recommended" : ""}`}
      aria-label={name}
    >
      <h2>{name}</h2>
      {option.kind === "unavailable" ? (
        <UnavailableDetails option={option} purchaseEnabled={purchaseEnabled} />
      ) : (
        <>
          {highlighted && (
            <p className="retailer-option__recommendation">
              {tied
                ? "Recommended — joint lowest estimated total"
                : "Recommended — lowest estimated total"}
            </p>
          )}
          <OrderBreakdown
            order={option}
            retailerName={name}
            totalLabel="Estimated total"
            purchaseEnabled={purchaseEnabled}
          />
          <p>
            Rebuild this basket and complete checkout manually on the retailer’s website. CartOptix
            does not transfer carts or reserve stock.
          </p>
        </>
      )}
    </article>
  );
}

/**
 * Why the retailer cannot take this basket, what checking out what it has
 * would cost, and the products it does not have. Never ranked or recommended.
 */
function UnavailableDetails({
  option,
  purchaseEnabled,
}: {
  option: UnavailableRetailerOption;
  purchaseEnabled: boolean;
}) {
  const missing = option.missingProducts ?? [];
  const partial = option.partial;
  const items = (partial?.lines.length ?? 0) + missing.length;
  const title =
    missing.length > 0
      ? "Incomplete basket"
      : option.explanations?.some(({ reason }) => reason.code === "below_minimum_order")
        ? "Below minimum order"
        : "Unavailable";
  return (
    <>
      <p>
        <strong>{title}</strong>
      </p>
      <ul>
        {detailEntries(option.reasons).map(({ value: reason, key }) => (
          <li key={key}>{reason}</li>
        ))}
      </ul>
      {partial && (
        <OrderBreakdown
          order={partial}
          retailerName={option.retailer.name}
          totalLabel={
            missing.length > 0
              ? `Estimated total for ${partial.lines.length} of ${items} items`
              : "Estimated total"
          }
          purchaseEnabled={purchaseEnabled}
        />
      )}
      {missing.length > 0 && (
        <div className="retailer-option__missing">
          <h3>Not available at {option.retailer.name}</h3>
          <ul>
            {missing.map((product) => (
              <li key={product.productId}>
                <MissingProductImage product={product} />
                <div>
                  <Link className="text-link" href={`/product/${product.productId}`}>
                    {product.name}
                  </Link>
                  <p>
                    {product.packDescription} · Quantity: {product.quantity}{" "}
                    {product.quantity === 1 ? "pack" : "packs"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function MissingProductImage({ product }: { product: SubmittedProduct }) {
  const [failed, setFailed] = useState(false);
  if (!product.imageUrl || failed) return <span className="retailer-option__thumb" aria-hidden />;
  return (
    <img
      className="retailer-option__thumb"
      src={product.imageUrl}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function OrderBreakdown({
  order,
  retailerName,
  totalLabel,
  purchaseEnabled,
}: {
  order: OrderPresentation;
  retailerName: string;
  totalLabel: string;
  purchaseEnabled: boolean;
}) {
  return (
    <>
      <ul className="retailer-option__lines">
        {order.lines.map((line) => (
          <li key={line.productId}>
            <div>
              <strong>{line.name}</strong>
              <p>
                {line.packDescription} · Quantity: {line.quantity}{" "}
                {line.quantity === 1 ? "pack" : "packs"}
              </p>
              <p>
                Unit price: <WasPrice cents={line.pricing.originalPriceCents} />
                {formatSgd(line.pricing.unitPriceCents)} / pack
                {line.pricing.priceKind === "unconditional_sale" && " (sale price)"}
              </p>
              <ul>
                {detailEntries(line.pricing.itemCharges).map(({ value: charge, key }) => (
                  <li key={key}>
                    {charge.label}: {formatSgd(charge.amountCents)} for this line
                    {charge.includedInPrice
                      ? " (included in unit price)"
                      : " (additional charge, already included in line total)"}
                  </li>
                ))}
                {detailEntries(
                  multibuyNotes(line.pricing.multibuy, line.quantity, line.pricing.unitPriceCents),
                ).map(({ value: note, key }) => (
                  <li key={key}>{note}</li>
                ))}
                {detailEntries(line.pricing.excludedPromotions).map(({ value: note, key }) => (
                  <li key={key}>{excludedPromotionNote(note)}</li>
                ))}
              </ul>
              {purchaseEnabled && (
                // TODO(#10, #16): call recordOutboundClick(listingId) before opening the link
                <a
                  className="text-link"
                  href={line.purchaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View {line.name} at {retailerName}
                </a>
              )}
            </div>
            <strong>{formatSgd(line.amountCents)}</strong>
          </li>
        ))}
      </ul>
      <dl className="retailer-option__amounts">
        <div>
          <dt>Product subtotal</dt>
          <dd>{formatSgd(order.productSubtotalCents)}</dd>
        </div>
        {detailEntries(order.charges).map(({ value: charge, key }) => (
          <div key={key}>
            <dt>{charge.label}</dt>
            <dd>{formatSgd(charge.amountCents)}</dd>
          </div>
        ))}
        <div>
          <dt>{totalLabel}</dt>
          <dd>
            <strong>{formatSgd(order.estimatedTotalCents)}</strong>
          </dd>
        </div>
      </dl>
    </>
  );
}
