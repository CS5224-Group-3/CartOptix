import type { RetailerOption } from "../../features/basket-comparison/model";
import { formatSgd } from "../../lib/format";

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
  return (
    <article
      className={`order-card retailer-option ${highlighted ? "retailer-option--recommended" : ""}`}
      aria-label={option.retailer.name}
    >
      <h2>{option.retailer.name}</h2>
      {option.kind === "unavailable" ? (
        <>
          <p>
            <strong>Unavailable</strong>
          </p>
          <ul>
            {detailEntries(option.reasons).map(({ value: reason, key }) => (
              <li key={key}>{reason}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {highlighted && (
            <p className="retailer-option__recommendation">
              {tied
                ? "Recommended — joint lowest estimated total"
                : "Recommended — lowest estimated total"}
            </p>
          )}
          <ul className="retailer-option__lines">
            {option.lines.map((line) => (
              <li key={line.productId}>
                <div>
                  <strong>{line.name}</strong>
                  <p>
                    {line.packDescription} · Quantity: {line.quantity}{" "}
                    {line.quantity === 1 ? "pack" : "packs"}
                  </p>
                  <p>
                    Unit price: {formatSgd(line.pricing.unitPriceCents)} / pack
                    {line.pricing.priceKind === "unconditional_sale" && " (unconditional sale)"}
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
                    {detailEntries(line.pricing.excludedPromotions).map(({ value: note, key }) => (
                      <li key={key}>Excluded promotion: {note}</li>
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
                      View {line.name} at {option.retailer.name}
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
              <dd>{formatSgd(option.productSubtotalCents)}</dd>
            </div>
            {detailEntries(option.charges).map(({ value: charge, key }) => (
              <div key={key}>
                <dt>{charge.label}</dt>
                <dd>{formatSgd(charge.amountCents)}</dd>
              </div>
            ))}
            <div>
              <dt>Estimated total</dt>
              <dd>
                <strong>{formatSgd(option.estimatedTotalCents)}</strong>
              </dd>
            </div>
          </dl>
          <p>
            Rebuild this basket and complete checkout manually on the retailer’s website. CartOptix
            does not transfer carts or reserve stock.
          </p>
        </>
      )}
    </article>
  );
}
