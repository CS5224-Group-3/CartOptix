// Shared jsdom setup: browser APIs the UI libraries expect, and cleanup between tests.
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

configure({ asyncUtilTimeout: 5_000 });

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
