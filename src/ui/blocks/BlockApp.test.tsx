// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockApp } from "./BlockApp";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});
function tile(id: string): HTMLElement {
  const item = document.querySelector(`[data-indicator="${id}"]`);
  if (!(item instanceof HTMLElement)) throw new Error(`Missing tile ${id}`);
  return item;
}
function change(id: string, value: string): void {
  const item = document.getElementById(`block-input-${id}`);
  if (!(item instanceof HTMLInputElement)) throw new Error(`Missing control ${id}`);
  fireEvent.input(item, { target: { value } });
}

describe("tile explanation when nothing reaches a tile", () => {
  it("names the hop limit, a missing incoming edge, or no connections at all", () => {
    // fed_rate -> inflation -> earnings -> income is 3 hops; income -> poverty would be the 4th.
    window.history.replaceState(null, "", "/?l=fed_rate:100");
    render(<BlockApp />);
    const why = (id: string) => tile(id).querySelector(".bb-why")?.textContent;
    expect(tile("median_household_income").dataset.state).toBe("up");
    expect(tile("poverty_rate").dataset.state).toBe("idle");
    expect(why("poverty_rate")).toBe("No input reaches this tile within 3 relationships.");
    expect(why("productivity")).toBe(
      "No incoming relationships; only your own input moves this tile.",
    );
    expect(why("hate_crimes")).toBe("No modeled connections.");
    expect(why("fed_rate")).toBe("Your manual input.");
  });
});

describe("active Block Board", () => {
  it("renders twenty red neutral grids with one hundred squares each under StrictMode", () => {
    render(
      <StrictMode>
        <BlockApp />
      </StrictMode>,
    );
    expect(screen.getByRole("heading", { name: "Block Board", level: 1 })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Ruot Koang Thor (Thor Thor)", level: 2 }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "LinkedIn" }).getAttribute("href")).toBe(
      "https://www.linkedin.com/in/ruot-koang-thor-monyjang-luak-pech-both-doah-yoal-joak",
    );
    expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
      "https://github.com/codethor0",
    );
    expect(screen.getByRole("link", { name: "Source" }).getAttribute("href")).toBe(
      "https://github.com/codethor0/us-systems-lab",
    );
    expect(screen.getAllByRole("slider")).toHaveLength(20);
    for (const grid of document.querySelectorAll(".bb-grid")) {
      expect(grid.querySelectorAll(".bb-square")).toHaveLength(100);
      expect(grid.querySelectorAll(".bb-filled")).toHaveLength(50);
    }
    expect(tile("productivity").dataset.state).toBe("idle");
    expect(document.querySelector(".react-flow")).toBeNull();
  });
  it("moves actual downstream squares without creating downstream inputs", async () => {
    render(<BlockApp />);
    change("productivity", "100");
    expect(tile("productivity").dataset.filled).toBe("100");
    expect(tile("real_avg_hourly_earnings").dataset.filled).toBe("63");
    expect(tile("poverty_rate").dataset.filled).toBe("48");
    expect(tile("fed_rate").dataset.filled).toBe("50");
    expect(tile("real_avg_hourly_earnings").querySelector("input")?.value).toBe("50");
    expect(window.location.search).toContain("productivity:100");
    expect(window.location.search).not.toContain("real_avg_hourly_earnings:");
    change("productivity", "0");
    expect(tile("real_avg_hourly_earnings").dataset.filled).toBe("37");
    expect(tile("poverty_rate").dataset.filled).toBe("52");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(tile("real_avg_hourly_earnings").dataset.filled).toBe("50");
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
  });
  it("moves the automatic response track and leaves downstream manual inputs alone", () => {
    render(<BlockApp />);
    expect(
      document.querySelectorAll("[data-auto-response]"),
      "MISSING_AUTOMATIC_RESPONSE_BAR",
    ).toHaveLength(20);
    expect(screen.getAllByRole("meter")).toHaveLength(20);
    const earnings = screen.getByRole("meter", {
      name: "Real hourly earnings normalized model response",
    });
    expect(earnings.getAttribute("aria-valuenow")).toBe("50");
    change("productivity", "100");
    expect(earnings.getAttribute("aria-valuenow")).toBe("62.5");
    expect(earnings.querySelector<HTMLElement>(".bb-response-fill")?.style.width).toBe("62.5%");
    expect(earnings.querySelector<HTMLElement>(".bb-response-marker")?.style.left).toBe("62.5%");
    expect(tile("real_avg_hourly_earnings").querySelector("input")?.value).toBe("50");
    change("productivity", "0");
    expect(earnings.getAttribute("aria-valuenow")).toBe("37.5");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(earnings.getAttribute("aria-valuenow")).toBe("50");
  });
  it("updates an open share field when history loads a neutral scenario", () => {
    render(<BlockApp />);
    change("productivity", "100");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    window.history.pushState(null, "", "/");
    fireEvent.popState(window);
    const field = screen.getByLabelText("Copy this scenario link");
    if (!(field instanceof HTMLInputElement)) throw new Error("Missing share field");
    expect(new URL(field.value).search).toBe("");
    expect(tile("productivity").dataset.position).toBe("50");
  });
  it("shows an exactly cancelling scenario as balanced rather than a phantom increase", () => {
    render(<BlockApp />);
    change("fed_rate", "70");
    change("mortgage_rate", "35");
    expect(tile("mortgage_rate").dataset.state).toBe("balanced");
    expect(tile("mortgage_rate").querySelector(".bb-state")?.textContent).toBe("Unchanged");
    expect(tile("mortgage_rate").querySelector(".bb-change")?.textContent).toBe("Score 0");
    expect(
      tile("mortgage_rate").querySelector("[data-auto-response]")?.getAttribute("aria-valuenow"),
    ).toBe("50");
  });
  it("keeps the status line and announcement in step with every input", () => {
    render(<BlockApp />);
    const counts = (): string | null => document.querySelector(".bb-counts")?.textContent ?? null;
    const message = (): string | null => document.querySelector(".bb-message")?.textContent ?? null;
    expect(counts()).toBe("20 indicators / 0 manual inputs / 0 tiles moved");
    change("productivity", "100");
    expect(counts()).toBe("20 indicators / 1 manual input / 5 tiles moved");
    expect(message()).toBe("Labor productivity: input 100/100. 5 tiles moved.");
    change("fed_rate", "100");
    expect(counts()).toContain("2 manual inputs");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(counts()).toBe("20 indicators / 0 manual inputs / 0 tiles moved");
  });
  it("lets block clicks set a manual input and shares only the manual scenario", () => {
    render(<BlockApp />);
    const square = tile("federal_debt").querySelector('[data-square="100"]');
    if (square === null) throw new Error("Missing square");
    fireEvent.click(square);
    expect(tile("net_interest").dataset.position).toBe("87.5");
    expect(tile("net_interest").dataset.own).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const field = screen.getByLabelText("Copy this scenario link");
    if (!(field instanceof HTMLInputElement)) throw new Error("Missing share link");
    expect(field.value).toContain("federal_debt:100");
    expect(field.value).not.toContain("net_interest:");
  });
  it("loads off-grid URLs, handles history, and clears invalid-link notices", () => {
    window.history.replaceState(null, "", "/?l=fed_rate:55");
    render(<BlockApp />);
    expect(tile("fed_rate").querySelector("input")?.value).toBe("80");
    expect(window.location.search).toContain("fed_rate:60");
    window.history.pushState(null, "", "/?l=constructor:100,junk:oops");
    fireEvent.popState(window);
    expect(tile("fed_rate").dataset.position).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(document.querySelector(".bb-notice")?.hasAttribute("hidden")).toBe(true);
  });
  it("keeps baseline provenance in details and disables motion without hiding responses", () => {
    render(<BlockApp />);
    fireEvent.click(screen.getByLabelText("Pulse changes"));
    change("fed_rate", "100");
    expect(tile("inflation").dataset.position).toBe("25");
    expect(document.querySelectorAll(".bb-pulse")).toHaveLength(0);
    expect(tile("inflation").querySelector("details")?.textContent).toContain(
      "Manual 0; incoming -0.5",
    );
    expect(tile("hate_crimes").textContent).toContain("No modeled connections");
  });
  it("sizes the exact position by length so decimals never break across lines", () => {
    render(<BlockApp />);
    const size = (id: string): string | undefined =>
      tile(id).querySelector<HTMLElement>(".bb-value")?.dataset.size;
    expect(size("productivity")).toBe("short");
    change("productivity", "100");
    expect(size("productivity")).toBe("short");
    expect(tile("real_avg_hourly_earnings").querySelector(".bb-value")?.textContent).toBe("62.5");
    expect(size("real_avg_hourly_earnings")).toBe("mid");
    expect(tile("median_household_income").querySelector(".bb-value")?.textContent).toBe("54.375");
    expect(size("median_household_income")).toBe("long");
  });
  it("states what each tile drives, including indicators that drive nothing", () => {
    render(<BlockApp />);
    expect(tile("productivity").textContent).toContain("Directly drives: Real hourly earnings.");
    expect(tile("productivity").dataset.drives).toBe("1");
    expect(tile("savings_rate").textContent).toContain(
      "Drives nothing else in this model, so moving it changes only this tile.",
    );
    expect(tile("savings_rate").dataset.drives).toBe("0");
    expect(tile("hate_crimes").querySelector(".bb-feeds")).toBeNull();
    expect(tile("hate_crimes").dataset.drives).toBe("0");
  });
});

describe("URL synchronization under rapid input", () => {
  it("keeps the latest scenario in Share while a URL write is queued, then lets Reset win", async () => {
    render(<BlockApp />);
    change("productivity", "100");
    change("productivity", "0");
    expect(tile("real_avg_hourly_earnings").dataset.position).toBe("37.5");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const field = screen.getByLabelText("Copy this scenario link");
    if (!(field instanceof HTMLInputElement)) throw new Error("Missing share field");
    expect(new URL(field.value).search).toContain("productivity:-100");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(tile("productivity").dataset.own).toBe("0");
    expect(tile("real_avg_hourly_earnings").dataset.position).toBe("50");
    expect(new URL(field.value).search).toBe("");
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 450);
    });
    expect(window.location.search).toBe("");
    expect(document.querySelector("[data-block-board]")?.getAttribute("data-url-sync")).toBe(
      "synced",
    );
  });
  it("does not overwrite history navigation with an older queued input", async () => {
    render(<BlockApp />);
    change("productivity", "100");
    change("productivity", "0");
    window.history.pushState(null, "", "/?l=federal_debt:100");
    fireEvent.popState(window);
    expect(tile("productivity").dataset.own).toBe("0");
    expect(tile("federal_debt").dataset.own).toBe("1");
    await waitFor(() => {
      expect(window.location.search).toContain("v=1");
    });
    expect(window.location.search).toContain("federal_debt:100");
    expect(window.location.search).not.toContain("productivity:");
  });
  it("does not restore a queued input after history navigates to a neutral URL", async () => {
    render(<BlockApp />);
    change("productivity", "100");
    change("productivity", "0");
    expect(document.querySelector("[data-block-board]")?.getAttribute("data-url-sync")).toBe(
      "pending",
    );
    window.history.pushState(null, "", "/");
    fireEvent.popState(window);
    expect(tile("productivity").dataset.own).toBe("0");
    expect(tile("real_avg_hourly_earnings").dataset.position).toBe("50");
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 450);
    });
    expect(window.location.search).toBe("");
    expect(document.querySelector("[data-block-board]")?.getAttribute("data-url-sync")).toBe(
      "synced",
    );
  });
  it("cancels queued writes when the board is unmounted", async () => {
    const mounted = render(<BlockApp />);
    change("productivity", "100");
    change("productivity", "0");
    mounted.unmount();
    window.history.replaceState(null, "", "/?outside=1");
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 450);
    });
    expect(window.location.search).toBe("?outside=1");
  });
  it("reports rejected URL writes without interrupting the model or Share", () => {
    render(<BlockApp />);
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new DOMException("Simulated history rejection", "SecurityError");
    });
    change("productivity", "100");
    expect(tile("real_avg_hourly_earnings").dataset.position).toBe("62.5");
    expect(
      screen.getByText("The address bar could not be updated. Use Share for the current scenario."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const field = screen.getByLabelText("Copy this scenario link");
    if (!(field instanceof HTMLInputElement)) throw new Error("Missing share field");
    expect(new URL(field.value).search).toContain("productivity:100");
  });
});

describe("review regressions", () => {
  // debt_growth_rate and gdp_growth stay unset: both reach net_interest through the federal debt
  // loop, and setting them would move its exact total away from 1.
  const EXACT_ONE_SCENARIO =
    "fed_rate:80,federal_debt:40,food_insecurity:70,hate_crimes:40," +
    "homelessness:-30,household_debt:60,inflation:80,institutional_confidence:-20,media_trust:10," +
    "median_household_income:-100,mortgage_rate:50,net_interest:10,payrolls_headline:-50," +
    "poverty_rate:-60,productivity:70,savings_rate:90,worker_bargaining_power:20";
  it("names the display limit only when a total genuinely exceeds one", () => {
    // The exact rational total for net_interest here is 1; floating point gives 1.0000000000000002.
    window.history.replaceState(null, "", `/?l=${EXACT_ONE_SCENARIO}`);
    const first = render(<BlockApp />);
    expect(tile("net_interest").dataset.position).toBe("100");
    expect(tile("net_interest").textContent).not.toContain("(display limit)");
    first.unmount();
    // Positive control: savings_rate really totals about 1.32 here, so the label must appear.
    window.history.replaceState(null, "", "/?l=fed_rate:100,savings_rate:100");
    render(<BlockApp />);
    expect(tile("savings_rate").textContent).toContain("(display limit)");
  });
  it("rewrites only the changed input readout, leaving other live regions untouched", () => {
    render(<BlockApp />);
    const watched = tile("federal_debt").querySelector("output");
    const changed = tile("productivity").querySelector("output");
    if (watched === null || changed === null) throw new Error("Missing input readouts");
    const observer = new MutationObserver(() => undefined);
    observer.observe(watched, { childList: true, characterData: true, subtree: true });
    change("productivity", "100");
    expect(observer.takeRecords()).toHaveLength(0);
    expect(changed.textContent).toBe("100/100");
    observer.disconnect();
  });
  it("keeps the visible words inside every control's accessible name", () => {
    render(<BlockApp />);
    for (const item of document.querySelectorAll("[data-indicator]")) {
      const slider = item.querySelector("input[type=range]");
      const neutral = item.querySelector(".bb-neutral");
      expect(slider?.getAttribute("aria-label")).toMatch(/^Your input\b/);
      expect(neutral?.getAttribute("aria-label")).toMatch(/^Neutral\b/);
    }
  });
  it("caps pulses at one per tile per second however fast inputs change", () => {
    render(<BlockApp />);
    change("productivity", "100");
    change("productivity", "0");
    change("productivity", "100");
    change("productivity", "20");
    expect(tile("productivity").dataset.pulses).toBe("1");
    expect(tile("real_avg_hourly_earnings").dataset.pulses).toBe("1");
    expect(tile("hate_crimes").dataset.pulses).toBeUndefined();
  });
});

describe("share link copy", () => {
  function shareField(): HTMLInputElement {
    const field = screen.getByLabelText("Copy this scenario link");
    if (!(field instanceof HTMLInputElement)) throw new Error("Missing share field");
    return field;
  }
  const status = (): string | null =>
    document.querySelector(".bb-share-status")?.textContent ?? null;
  function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined): void {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: writeText === undefined ? undefined : { writeText },
    });
  }
  afterEach(() => {
    stubClipboard(undefined);
  });

  it("copies the current scenario link and confirms it in a status line", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    render(<BlockApp />);
    change("fed_rate", "100");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(shareField().value);
    expect(shareField().value).toContain("fed_rate:100");
    await waitFor(() => {
      expect(status()).toBe("Link copied.");
    });
    expect(document.querySelector(".bb-share-status")?.getAttribute("role")).toBe("status");
  });

  it("clears the confirmation when the link changes, so it never describes an older link", async () => {
    stubClipboard(() => Promise.resolve());
    render(<BlockApp />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => {
      expect(status()).toBe("Link copied.");
    });
    change("productivity", "100");
    expect(status()).toBe("");
  });

  it("selects the link and says so when the browser has no clipboard", () => {
    stubClipboard(undefined);
    render(<BlockApp />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(status()).toBe(
      "Could not copy automatically. The link is selected; copy it from there.",
    );
    expect(document.activeElement).toBe(shareField());
  });

  it("falls back the same way when the clipboard refuses the write", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(<BlockApp />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => {
      expect(status()).toBe(
        "Could not copy automatically. The link is selected; copy it from there.",
      );
    });
    expect(document.activeElement).toBe(shareField());
  });
});

describe("model transparency and analysis", () => {
  function choose(label: string): void {
    fireEvent.click(screen.getByRole("radio", { name: label }));
  }
  function evidenceOnly(): HTMLInputElement {
    const box = screen.getByRole("checkbox", { name: "Cited relationships only" });
    if (!(box instanceof HTMLInputElement)) throw new Error("Missing evidence toggle");
    return box;
  }

  it("shows the real-world baseline apart from the normalized model response", () => {
    render(<BlockApp />);
    const baseline = (id: string) => tile(id).querySelector(".bb-baseline")?.textContent;
    expect(baseline("inflation")).toBe("Real-world baseline: 3.4 % YoY (2026-08)");
    expect(baseline("net_interest")).toBe("Real-world projection: 3.3 % of GDP (FY2026)");
    expect(baseline("debt_growth_rate")).toBe("Real-world baseline: not stored yet");
    expect(baseline("worker_bargaining_power")).toBe(
      "Real-world value: none (abstract 0 to 100 lever)",
    );
    expect(tile("inflation").querySelector(".bb-micro")?.textContent).toBe("MODEL RESPONSE");
  });

  it("filters tiles by category without changing the calculation or the address", () => {
    window.history.replaceState(null, "", "/?l=fed_rate:100");
    render(<BlockApp />);
    const before = tile("median_household_income").dataset.position;
    const search = window.location.search;
    choose("fiscal");
    expect(tile("federal_debt").hidden).toBe(false);
    expect(tile("inflation").hidden).toBe(true);
    expect(tile("median_household_income").dataset.position).toBe(before);
    expect(screen.getByText(/Showing 3 of 20 indicators/)).toBeTruthy();
    expect(window.location.search).toBe(search);
    choose("All indicators");
    expect(tile("inflation").hidden).toBe(false);
    expect(screen.queryByText(/Showing \d+ of 20 indicators/)).toBeNull();
  });

  it("uses only cited relationships in evidence-only mode and says why nothing moves", () => {
    window.history.replaceState(null, "", "/?l=fed_rate:100");
    render(<BlockApp />);
    const search = window.location.search;
    expect(tile("mortgage_rate").dataset.state).toBe("up");
    fireEvent.click(evidenceOnly());
    expect(tile("mortgage_rate").dataset.state).toBe("idle");
    expect(tile("fed_rate").dataset.position).toBe("100");
    expect(tile("mortgage_rate").querySelector(".bb-why")?.textContent).toBe(
      "No cited relationship reaches this tile. That is a gap in citations, not evidence of no effect.",
    );
    expect(screen.getByText(/0 of 22 relationships have a citation/)).toBeTruthy();
    expect(tile("fed_rate").querySelector(".bb-feeds")?.textContent).toBe(
      "Drives nothing through cited relationships; its links are modeled.",
    );
    expect(window.location.search).toBe(search);
    fireEvent.click(evidenceOnly());
    expect(tile("mortgage_rate").dataset.state).toBe("up");
  });

  it("says how each moved tile holds up across the tested settings", () => {
    window.history.replaceState(null, "", "/?l=fed_rate:100");
    render(<BlockApp />);
    const robust = (id: string) => tile(id).querySelector(".bb-robustness")?.textContent;
    expect(robust("mortgage_rate")).toBe("Same direction under all 9 tested settings.");
    // fed -> inflation -> real earnings -> median income needs 3 relationships: zero at 2.
    expect(robust("median_household_income")).toMatch(/^Moves under some tested settings only/);
    expect(robust("poverty_rate")).toBe("");
  });

  it("compares with a saved scenario A held in memory only", () => {
    window.history.replaceState(null, "", "/?l=fed_rate:100");
    render(<BlockApp />);
    const compare = (id: string) => tile(id).querySelector<HTMLElement>(".bb-compare");
    expect(compare("mortgage_rate")?.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save as scenario A" }));
    change("fed_rate", "50");
    expect(compare("mortgage_rate")?.textContent).toBe("Scenario A 87.5, now 50 (-37.5).");
    expect(screen.getByText(/Comparing with scenario A: \d+ of 20 tiles differ/)).toBeTruthy();
    expect(window.location.search).not.toContain("A");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(compare("mortgage_rate")?.hidden).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Clear A" }));
    expect(compare("mortgage_rate")?.hidden).toBe(true);
    expect(screen.queryByRole("button", { name: "Clear A" })).toBeNull();
  });

  it("lists paths strongest first with the kind of every step", () => {
    window.history.replaceState(null, "", "/?l=fed_rate:100");
    render(<BlockApp />);
    const rows = [...tile("savings_rate").querySelectorAll(".bb-paths li")];
    // fed direct 0.25, then via inflation and earnings 0.0459375, then via mortgage and debt 0.02296875.
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Federal funds rate > Personal saving rate: +0.25",
      "Federal funds rate > Inflation > Real hourly earnings > Personal saving rate: +0.0459",
      "Federal funds rate > 30-year mortgage rate > Household debt > Personal saving rate: +0.023",
    ]);
    expect(rows[1]?.querySelector(".bb-steps")?.textContent).toBe(
      "Each step: down (Causal | modeled | long run); down (Accounting | modeled | short run); up (Causal | modeled | short run)",
    );
  });

  it("labels relationships and states why a dead end drives nothing", () => {
    render(<BlockApp />);
    const badges = [...tile("fed_rate").querySelectorAll(".bb-badge")].map((b) => b.textContent);
    expect(badges).toContain("Causal | modeled | short run");
    expect(tile("savings_rate").querySelector(".bb-terminal")?.textContent).toMatch(
      /^Drives nothing: /,
    );
    expect(tile("hate_crimes").textContent).toContain("Isolated on purpose.");
  });
});
