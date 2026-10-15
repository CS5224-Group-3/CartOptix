import { routes } from "@cartoptix/contracts";
import {
  basketRequestExample,
  noFeasiblePlanExample,
  productsExample,
  recommendedExample,
} from "@cartoptix/contracts/fixtures";
import { describe, expect, it, vi } from "vitest";
import { createApiSource } from "../src/features/basket-comparison/apiSource";
import {
  type ComparisonSubmission,
  PresentationDataFailure,
} from "../src/features/basket-comparison/model";

function submission(): ComparisonSubmission {
  return {
    scenario: "must-not-be-sent",
    basket: {
      revision: 9,
      products: basketRequestExample.lines.map((line) => {
        const product = productsExample.products.find(
          (product) => product.productId === line.productId,
        );
        if (!product) throw new Error("Missing product");
        return { ...line, name: product.name, packDescription: product.packSize };
      }),
    },
  };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("API-backed comparison source (opt-in)", () => {
  it.each([recommendedExample, noFeasiblePlanExample])(
    "sends only the shared request and treats business outcomes as success",
    async (response) => {
      const fetchMock = vi.fn().mockResolvedValue(json(response));
      vi.stubGlobal("fetch", fetchMock);
      const result = await createApiSource()(submission());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(routes.compare.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(basketRequestExample),
      });
      expect(result.outcome.kind).toBe(
        response.status === "recommended" ? "recommended" : "no-feasible-plan",
      );
      expect(result.provenance?.kind).toBe("curated");
    },
  );

  it("captures metadata and quantities before waiting for HTTP", async () => {
    let resolveResponse: (response: Response) => void = () => {
      throw new Error("Not started");
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    const input = submission();
    const before = structuredClone(input.basket);
    const pending = createApiSource()(input);
    input.basket.products.splice(0);
    input.basket.revision += 1;
    resolveResponse(json(recommendedExample));
    expect((await pending).submittedBasket).toEqual(before);
  });

  it.each([
    [400, "invalid_request", false],
    [404, "not_found", false],
    [500, "service_error", true],
    [503, undefined, true],
    [403, undefined, false],
  ] as const)("classifies HTTP %s / %s", async (status, code, retryable) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: { code, message: "Failure" } }, status)),
    );
    await expect(createApiSource()(submission())).rejects.toMatchObject({ retryable });
  });

  it("makes network failures retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(createApiSource()(submission())).rejects.toMatchObject({ retryable: true });
  });

  it.each([
    null,
    {},
    { status: "recommended", options: [] },
    { status: "unknown", options: [] },
    { ...recommendedExample, recommendedRetailerId: "redmart" },
    { ...noFeasiblePlanExample, options: recommendedExample.options },
  ])("rejects malformed or inconsistent success data safely", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(body)));
    const failure = createApiSource()(submission());
    await expect(failure).rejects.toBeInstanceOf(PresentationDataFailure);
    await expect(failure).rejects.toMatchObject({ retryable: false });
  });

  it("treats malformed success JSON as a presentation failure, not network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(createApiSource()(submission())).rejects.toBeInstanceOf(PresentationDataFailure);
  });

  it("rejects missing snapshot metadata before HTTP; no implicit lookup", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const input = submission();
    const product = input.basket.products[0];
    if (!product) throw new Error("Missing product");
    product.packDescription = "";
    await expect(createApiSource()(input)).rejects.toBeInstanceOf(PresentationDataFailure);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
