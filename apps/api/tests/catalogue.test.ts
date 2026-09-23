import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";

const database = {
  checkConnection: async () => ({ status: "ok" as const }),
  close: async () => undefined,
};

describe("catalogue API", () => {
  let server: ReturnType<typeof buildServer> | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it("returns dataset, retailer, category and delivery metadata", async () => {
    server = buildServer({ database });

    const response = await server.inject({ method: "GET", url: "/api/v1/catalogue" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.dataset).toEqual({ datasetId: "fixture-v1", dataKind: "synthetic" });
    expect(body.retailers).toHaveLength(3);
    expect(body.categories).toEqual([
      { categoryId: "drinks", name: "Drinks" },
      { categoryId: "rice-noodles", name: "Rice & Noodles" },
    ]);
    expect(body.delivery.scenario).toBeTruthy();
    expect(body).not.toHaveProperty("collectionDate");
  });
});
