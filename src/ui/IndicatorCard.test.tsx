// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import graphJson from "../data/graph.json";
import { parseGraph } from "../lib/validate";
import type { NodeDescription } from "../model/explain";
import { IndicatorCard } from "./IndicatorCard";

afterEach(cleanup);

const graph = parseGraph(graphJson);
const fedRate = graph.nodes.find((node) => node.id === "fed_rate");
const worker = graph.nodes.find((node) => node.id === "worker_bargaining_power");
if (fedRate === undefined || worker === undefined) throw new Error("fixture nodes are missing");

const description: NodeDescription = {
  nodeId: "fed_rate",
  label: "Federal funds rate",
  direction: "up",
  bucket: "moderate",
  headline: "Federal funds rate: up, moderate",
  isLever: true,
  why: null,
  whyText: null,
  otherRoutes: 0,
};

describe("IndicatorCard", () => {
  it("shows provenance context and a 21-position normalized scenario slider", () => {
    const onLeverChange = vi.fn();
    render(
      <IndicatorCard
        node={fedRate}
        lever={0.5}
        description={description}
        flashKey={0}
        onLeverChange={onLeverChange}
      />,
    );

    expect(screen.getByText("Federal funds rate")).toBeTruthy();
    expect(screen.getByText("3.875 % (target range midpoint)")).toBeTruthy();
    expect(screen.getByText("+50% of display range")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Baseline source" }).getAttribute("href")).toBe(
      fedRate.sourceUrl,
    );

    const slider = screen.getByRole("slider", {
      name: "Scenario adjustment for Federal funds rate",
    });
    expect(slider.getAttribute("min")).toBe("-100");
    expect(slider.getAttribute("max")).toBe("100");
    expect(slider.getAttribute("step")).toBe("10");
    expect(slider.getAttribute("value")).toBe("50");

    fireEvent.change(slider, { target: { value: "-30" } });
    expect(onLeverChange).toHaveBeenCalledWith("fed_rate", -0.3);
  });

  it("does not invent a baseline or a source for an abstract index", () => {
    render(
      <IndicatorCard
        node={worker}
        lever={0}
        description={null}
        flashKey={0}
        onLeverChange={vi.fn()}
      />,
    );
    expect(screen.getByText("No measured baseline")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Baseline source" })).toBeNull();
    expect(screen.getByText("Worker bargaining power: no visible change")).toBeTruthy();
  });

  it("exposes the qualitative settled state and creates a fresh flash layer when its key changes", () => {
    const { container, rerender } = render(
      <IndicatorCard
        node={fedRate}
        lever={0.5}
        description={description}
        flashKey={1}
        onLeverChange={vi.fn()}
      />,
    );
    const card = container.querySelector("[data-node-id='fed_rate']");
    expect(card?.getAttribute("data-effect")).toBe("up");
    expect(card?.getAttribute("data-bucket")).toBe("moderate");
    expect(container.querySelector("[data-flash-key='1']")).not.toBeNull();

    rerender(
      <IndicatorCard
        node={fedRate}
        lever={0.5}
        description={description}
        flashKey={2}
        onLeverChange={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-flash-key='1']")).toBeNull();
    expect(container.querySelector("[data-flash-key='2']")).not.toBeNull();
  });
});
