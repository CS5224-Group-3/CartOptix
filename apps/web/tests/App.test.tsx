import type { ReadinessResponse } from "@cartoptix/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockReadiness(readiness: ReadinessResponse): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(readiness))),
  );
}

describe("App", () => {
  it("renders the readiness reported by the API", async () => {
    mockReadiness({ status: "ok", checks: { database: { status: "ok" } } });

    render(<App />);

    expect(await screen.findByText("CartOptix")).toBeDefined();
    expect(await screen.findAllByText("ok")).toHaveLength(2);
  });

  it("shows the database failure detail when the API is unavailable", async () => {
    mockReadiness({
      status: "unavailable",
      checks: { database: { status: "unavailable", detail: "connection refused" } },
    });

    render(<App />);

    expect(await screen.findByText(/connection refused/)).toBeDefined();
  });
});
