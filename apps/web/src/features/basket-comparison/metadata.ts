import type { OffersResponse, Product } from "@cartoptix/contracts";
import { fetchOffers } from "../../lib/api";
import { validateSnapshot } from "./adapter";
import { classifyApiFailure } from "./failures";
import { type ComparisonSubmission, PresentationDataFailure } from "./model";
/** Resolve missing metadata in a clone, retaining verified products for later editing. */
export async function resolveSubmissionMetadata(
  captured: ComparisonSubmission,
  onResolved?: (product: Product) => void,
): Promise<ComparisonSubmission> {
  const submitted = structuredClone(captured);
  submitted.basket.products = await Promise.all(
    submitted.basket.products.map(async (line) => {
      if (line.name?.trim() && line.packDescription?.trim()) return line;
      let response: OffersResponse;
      try {
        response = await fetchOffers(line.productId, line.quantity);
      } catch (error) {
        throw classifyApiFailure(error);
      }
      const product = response?.product;
      if (
        product?.productId !== line.productId ||
        typeof product.name !== "string" ||
        !product.name.trim() ||
        typeof product.packSize !== "string" ||
        !product.packSize.trim()
      )
        throw new PresentationDataFailure();
      onResolved?.(structuredClone(product));
      return {
        ...line,
        name: line.name?.trim() ? line.name : product.name,
        packDescription: line.packDescription?.trim() ? line.packDescription : product.packSize,
        imageUrl: line.imageUrl ?? product.imageUrl,
      };
    }),
  );
  validateSnapshot(submitted.basket);
  return submitted;
}
