import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";

const database = {
  checkConnection: async () => ({ status: "ok" as const }),
  close: async () => undefined,
};

describe("products API", () => {
  let server: ReturnType<typeof buildServer> | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it("returns paginated products and the unpaginated total", async () => {
    server = buildServer({ database });

    const response = await server.inject({ method: "GET", url: "/api/v1/products?page=1&pageSize=1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      products: [expect.objectContaining({ productId: "fixture-drink" })],
      total: 2,
    });
  });

  it("searches product identity fields and filters by category", async () => {
    server = buildServer({ database });

    const search = await server.inject({ method: "GET", url: "/api/v1/products?q=RICE" });
    expect(search.statusCode).toBe(200);
    expect(search.json().products.map((product: { productId: string }) => product.productId)).toEqual(["fixture-rice"]);

    const category = await server.inject({ method: "GET", url: "/api/v1/products?categoryId=drinks" });
    expect(category.statusCode).toBe(200);
    expect(category.json().products.map((product: { productId: string }) => product.productId)).toEqual(["fixture-drink"]);
  });

  it("returns quantity-aware offers with promotion disclosures", async () => {
    server = buildServer({ database });

    const response = await server.inject({ method: "GET", url: "/api/v1/products/fixture-rice/offers?quantity=2" });

    expect(response.statusCode).toBe(200);
    expect(response.json().offers[0]).toEqual(expect.objectContaining({
      retailerId: "fairprice",
      unitPriceCents: 410,
      lineTotalCents: 820,
      excludedPromotions: ["Unverified multibuy offer"],
    }));
  });

  it("rejects invalid quantities and reports unknown products", async () => {
    server = buildServer({ database });

    const invalid = await server.inject({ method: "GET", url: "/api/v1/products/fixture-rice/offers?quantity=21" });
    expect(invalid.statusCode).toBe(400);

    const missing = await server.inject({ method: "GET", url: "/api/v1/products/missing/offers?quantity=1" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });
});
