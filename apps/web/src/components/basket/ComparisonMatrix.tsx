import type { OrderCharge } from "@cartoptix/contracts";
import { useState } from "react";
import { Link } from "wouter";
import type {
  OrderPresentation,
  RetailerOption,
  SubmittedProduct,
} from "../../features/basket-comparison/model";
import { retailerSite } from "../../features/basket-comparison/retailer-sites";
import { excludedPromotionNote, formatSgd, multibuyNotes } from "../../lib/format";
import WasPrice from "../WasPrice";

type Line = OrderPresentation["lines"][number];

/** The order a column prices: a complete option's, or an unavailable one's labelled partial estimate. */
const orderOf = (option: RetailerOption): OrderPresentation | undefined =>
  option.kind === "complete" ? option : option.partial;

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
  products,
  recommendedId,
  tied,
  purchaseEnabled = true,
}: {
  options: RetailerOption[];
  products: SubmittedProduct[];
  recommendedId: string | null;
  tied: boolean;
  purchaseEnabled?: boolean;
}) {
  // Complete options always come first; a stable sort keeps the API's order otherwise (J3).
  const columns = [...options].sort(
    (a, b) => Number(a.kind === "unavailable") - Number(b.kind === "unavailable"),
  );
  // Rows follow the submitted basket, named once with its identity, so even a
  // result where no retailer could price anything shows what was asked for.
  const rows = products;
  // One row per (base label, per-order occurrence), unioned across columns.
  const charges: { label: string; occurrence: number }[] = [];
  for (const option of columns) {
    const seenPerOrder = new Map<string, number>();
    for (const charge of orderOf(option)?.orderCharges ?? []) {
      const occurrence = seenPerOrder.get(charge.label) ?? 0;
      seenPerOrder.set(charge.label, occurrence + 1);
      if (!charges.some((c) => c.label === charge.label && c.occurrence === occurrence))
        charges.push({ label: charge.label, occurrence });
    }
  }
  type FootRow = {
    key: string;
    label: string;
    charge: (o: OrderPresentation) => { cents: number; waivedFee?: OrderCharge } | undefined;
    total: boolean;
  };
  // Charges are matched by base label with an occurrence index: the same fee
  // keeps one row across retailers even when only one of them waives it, and
  // repeated labels keep separate amounts instead of losing one.
  const footRows: FootRow[] = [
    {
      key: "subtotal",
      label: "Product subtotal",
      charge: (o) => ({ cents: o.productSubtotalCents }),
      total: false,
    },
    {
      key: "delivery",
      label: "Delivery",
      charge: (o) => ({ cents: o.deliveryCents }),
      total: false,
    },
    ...charges.map(({ label, occurrence }) => ({
      key: `${label}:${occurrence}`,
      label,
      charge: (o: OrderPresentation) => {
        const match = o.orderCharges.filter((c) => c.label === label)[occurrence];
        return match
          ? {
              cents: match.waived ? 0 : match.amountCents,
              waivedFee: match.waived ? match : undefined,
            }
          : undefined;
      },
      total: false,
    })),
    {
      key: "total",
      label: "Estimated total",
      charge: (o) => ({ cents: o.estimatedTotalCents }),
      total: true,
    },
  ];
  return (
    <table className="matrix">
      <caption className="sr-only">Basket price by retailer</caption>
      <thead>
        <tr id="results-retailer-row">
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
        {rows.map((product, index) => (
          <tr key={product.productId} id={index === 0 ? "results-first-product" : undefined}>
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
        {footRows.map(({ key, label, charge, total }) => (
          <tr key={key} className={total ? "matrix__total-row" : undefined}>
            <th scope="row">{label}</th>
            {columns.map((option) => {
              const order = orderOf(option);
              const matched = order && charge(order);
              return (
                <td key={option.retailer.id} data-retailer={option.retailer.name}>
                  {matched === undefined
                    ? "—"
                    : matched.waivedFee
                      ? `${formatSgd(matched.waivedFee.amountCents)} waived on orders from ${formatSgd(matched.waivedFee.waivedFromCents ?? 0)}`
                      : formatSgd(matched.cents)}
                  {matched !== undefined && option.kind === "unavailable" && (
                    <span className="matrix__partial"> (partial estimate)</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
        <SignInRow columns={columns} />
      </tfoot>
    </table>
  );
}

/**
 * Where to sign in to finish the order, one cell per retailer.
 *
 * Last row because it follows the totals, which is where the shopper decides.
 * CartOptix cannot transfer a basket, so finishing an order always means
 * rebuilding it on the retailer's own site; this saves finding the sign-in
 * page.
 *
 * A cell is filled whenever that column prices something, which is not the
 * same as the basket being complete: an incomplete column still lists what it
 * can sell and links to those products, so withholding its sign-in would be
 * the odd half. Columns with nothing priced, and retailers with no verified
 * sign-in page, show an em dash rather than a guessed URL.
 */
function SignInRow({ columns }: { columns: RetailerOption[] }) {
  const sites = columns.map((option) =>
    orderOf(option) ? retailerSite(option.retailer.id) : undefined,
  );
  if (sites.every((site) => site === undefined)) return null;
  return (
    <tr className="matrix__signin-row">
      <th scope="row">Sign in to check out</th>
      {columns.map((option, index) => {
        const site = sites[index];
        return (
          <td key={option.retailer.id} data-retailer={option.retailer.name}>
            {site === undefined ? (
              "—"
            ) : (
              <a
                className="text-link"
                href={site.loginUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Sign in to {option.retailer.name}{" "}
                {/* Inside the anchor so the host is part of the same target,
                    not a dead label beside it. */}
                <span className="matrix__signin-host">({site.host})</span>
              </a>
            )}
          </td>
        );
      })}
    </tr>
  );
}
