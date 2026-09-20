// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DecodedScenario } from "../scenario/url";
import { ScenarioNotice } from "./ScenarioNotice";

afterEach(cleanup);

function report(overrides: Partial<DecodedScenario> = {}): DecodedScenario {
  return {
    levers: new Map(),
    problems: [],
    problemsOmitted: 0,
    stamp: "current",
    ...overrides,
  };
}

describe("ScenarioNotice", () => {
  it("describes a stale but otherwise valid link as a compatibility warning, not malformed input", () => {
    render(<ScenarioNotice report={report({ stamp: "stale" })} search="?v=1&d=deadbeef" />);
    expect(screen.getByText(/different graph data stamp/i)).toBeTruthy();
    expect(screen.queryByText(/parts of the link were ignored/i)).toBeNull();
  });

  it("shows decoder problems verbatim as ignored input and reports omitted problems", () => {
    render(
      <ScenarioNotice
        report={report({
          stamp: "invalid",
          problems: [
            {
              code: "malformed_stamp",
              token: "bad",
              message: 'The data stamp "bad" in the link is not valid and was ignored.',
            },
          ],
          problemsOmitted: 2,
        })}
        search="?d=bad"
      />,
    );
    expect(screen.getByText("Some parts of the link were ignored.")).toBeTruthy();
    expect(screen.getByText(/data stamp "bad"/i)).toBeTruthy();
    expect(screen.getByText("2 additional link problems were not shown.")).toBeTruthy();
  });

  it("distinguishes a scenario with no stamp from a malformed scenario", () => {
    render(<ScenarioNotice report={report({ stamp: "missing" })} search="?l=fed_rate:50" />);
    expect(screen.getByText(/has no data stamp/i)).toBeTruthy();
    expect(screen.queryByText(/parts of the link were ignored/i)).toBeNull();
  });

  it("renders nothing for a current link, an unrelated query, or after the report is cleared", () => {
    const { container, rerender } = render(
      <ScenarioNotice report={report()} search="?v=1&d=24ecb4b5" />,
    );
    expect(container.textContent).toBe("");

    rerender(<ScenarioNotice report={report({ stamp: "missing" })} search="?utm_source=test" />);
    expect(container.textContent).toBe("");

    rerender(<ScenarioNotice report={null} search="?l=fed_rate:50" />);
    expect(container.textContent).toBe("");
  });
});
