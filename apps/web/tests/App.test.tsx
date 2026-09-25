// Verifies the main web application renders its expected initial UI.
import { SNAPSHOT_DISCLAIMER } from "@cartoptix/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App.tsx";

describe("App", () => {
  it("renders the home page", () => {
    render(<App />);

    expect(screen.getByRole("link", { name: "CartOptix home" })).toBeDefined();
    expect(screen.getByRole("heading", { name: /smartest way to fill/i })).toBeDefined();
  });

  it("shows the shared fixed-dataset disclaimer", () => {
    render(<App />);

    expect(screen.getByText(SNAPSHOT_DISCLAIMER, { exact: false })).toBeDefined();
  });
});
