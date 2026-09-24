// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BlockApp } from "./BlockApp";

beforeAll(() => {
  const host = window as unknown as { matchMedia?: unknown };
  if (typeof host.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function open(search: string) {
  window.history.replaceState(null, "", `/${search}`);
  render(<BlockApp />);
  const notice = document.querySelector<HTMLElement>(".bb-notice");
  const tile = document.querySelector<HTMLElement>('[data-indicator="fed_rate"]');
  return { notice, tile };
}

describe("a shared link with a value between input steps", () => {
  it("applies the rounded value and says exactly what was rounded", () => {
    const { notice, tile } = open("?v=1&l=fed_rate:57");
    expect(tile?.dataset.own).toBe("0.6");
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain("78.5/100 to 80/100");
  });

  it("says so when a small value is rounded all the way to neutral", () => {
    const { notice, tile } = open("?v=1&l=fed_rate:4");
    expect(tile?.dataset.own).toBe("0");
    expect(notice?.textContent).toContain("52/100 to 50/100 (neutral)");
  });

  it("adds no rounding notice for a link already on the grid", () => {
    const { notice, tile } = open("?v=1&l=fed_rate:60");
    expect(tile?.dataset.own).toBe("0.6");
    expect(notice?.textContent ?? "").not.toContain("rounded");
  });
});
