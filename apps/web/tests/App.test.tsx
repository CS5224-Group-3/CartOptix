// Verifies the main web application renders its expected initial UI.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.tsx";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("renders the home page", () => {
    render(<App />);

    expect(screen.getByRole("link", { name: "CartOptix home" })).toBeDefined();
    expect(screen.getByRole("heading", { name: /smartest way to fill/i })).toBeDefined();
  });

  it("shows the fixed-dataset disclaimer", () => {
    render(<App />);

    expect(screen.getByText(/Fixed dataset prototype\. Estimates only/i)).toBeDefined();
  });
});
