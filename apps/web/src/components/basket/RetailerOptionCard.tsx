import type { RetailerOption } from "../../features/basket-comparison/model";
import { formatSgd } from "../../lib/format";

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
            {option.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
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
                  {purchaseEnabled && (
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
            {option.charges.map((charge) => (
              <div key={charge.label}>
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
          {purchaseEnabled && (
            <a
              className="button button--outline"
              href={option.retailer.purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit {option.retailer.name}
            </a>
          )}
          <p>
            Rebuild this basket and complete checkout manually on the retailer’s website. CartOptix
            does not transfer carts or reserve stock.
          </p>
        </>
      )}
    </article>
  );
}
