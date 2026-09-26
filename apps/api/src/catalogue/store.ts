import type { CatalogueResponse } from "@cartoptix/contracts";
import { catalogueExample } from "@cartoptix/contracts/fixtures";

export interface CatalogueStore {
  catalogue(): Promise<CatalogueResponse>;
}

export function createFixtureCatalogueStore(): CatalogueStore {
  return {
    async catalogue() {
      return structuredClone(catalogueExample);
    },
  };
}
