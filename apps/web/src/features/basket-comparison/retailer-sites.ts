import type { RetailerId } from "@cartoptix/contracts";

/**
 * Where a shopper signs in to finish an order.
 *
 * CartOptix does not transfer carts, so the basket has to be rebuilt on the
 * retailer's own site; these links save the shopper finding the sign-in page
 * themselves. They are not part of the comparison contract or the seed,
 * because they are not data about an offer: they are the same three addresses
 * whatever the seed contains.
 *
 * Each URL was checked to be the retailer's own sign-in entry point rather
 * than a guess at a conventional path, which is how `/login` was ruled out for
 * Cold Storage. If a retailer moves its sign-in page, the link breaks quietly,
 * so the card always names the retailer's site as well.
 */
export interface RetailerSite {
  /** The retailer's sign-in page. */
  readonly loginUrl: string;
  /** Host shown to the shopper, so an external link states where it leads. */
  readonly host: string;
}

export const RETAILER_SITES: Record<RetailerId, RetailerSite> = {
  // Redirects to NTUC's shared identity provider, which is the real sign-in.
  fairprice: { loginUrl: "https://www.fairprice.com.sg/login", host: "fairprice.com.sg" },
  // Not /login, which is a 404; this is the path the site's own header uses.
  "cold-storage": { loginUrl: "https://coldstorage.com.sg/auth/login", host: "coldstorage.com.sg" },
  // RedMart is a Lazada storefront, so signing in means signing in to Lazada.
  // This is the RedMart storefront rather than Lazada's deep login URL: that
  // deep link lands on Lazada's login widget with no prior session, which has
  // been seen to fail there with "接口异常退出" (interface exited abnormally).
  // Arriving at the storefront and using its own LOGIN control goes through
  // the flow Lazada expects, and a shopper who cannot sign in has still landed
  // where they need to rebuild the basket.
  redmart: { loginUrl: "https://redmart.lazada.sg/", host: "redmart.lazada.sg" },
};

/** Undefined for an unrecognised ID, so a new retailer shows no link rather than a wrong one. */
export function retailerSite(retailerId: string): RetailerSite | undefined {
  return RETAILER_SITES[retailerId as RetailerId];
}
