import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
} from "@xyflow/react";
import type { Edge, EdgeProps, Node, NodeProps } from "@xyflow/react";
import { CATEGORIES } from "../lib/schema";
import type { Graph, GraphEdge, GraphNode } from "../lib/schema";
import { layoutGraph } from "../layout/layout";
import type { FlashState } from "../model/flash";
import { describeEffect } from "../model/explain";
import type { NodeDescription } from "../model/explain";
import type { ScenarioEffect } from "../model/effects";
import { IndicatorCard } from "./IndicatorCard";

const UI_LAYOUT = {
  nodeWidth: 236,
  nodeHeight: 164,
  columnGap: 92,
  rowGap: 24,
  categoryOrder: CATEGORIES,
} as const;

type IndicatorData = {
  readonly node: GraphNode;
  readonly lever: number;
  readonly description: NodeDescription | null;
  readonly flashKey: number;
  readonly onLeverChange: (nodeId: string, value: number) => void;
};

type IndicatorFlowNode = Node<IndicatorData, "indicator">;

type CausalData = {
  readonly edge: GraphEdge;
  readonly backEdge: boolean;
};

type CausalFlowEdge = Edge<CausalData, "causal">;

function IndicatorNode({ data }: NodeProps<IndicatorFlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <IndicatorCard
        node={data.node}
        lever={data.lever}
        description={data.description}
        flashKey={data.flashKey}
        onLeverChange={data.onLeverChange}
      />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

function CausalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<CausalFlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const edge = data?.edge;
  const title = edge === undefined ? "Causal relationship" : `${edge.claim} (${edge.confidence})`;
  return (
    <g>
      {markerEnd === undefined ? (
        <BaseEdge id={id} path={path} interactionWidth={18} />
      ) : (
        <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={18} />
      )}
      <title>{title}</title>
    </g>
  );
}

const NODE_TYPES = { indicator: IndicatorNode };
const EDGE_TYPES = { causal: CausalEdge };

export interface GraphCanvasProps {
  readonly graph: Graph;
  readonly levers: ReadonlyMap<string, number>;
  readonly effects: readonly ScenarioEffect[];
  readonly flash: FlashState;
  readonly onLeverChange: (nodeId: string, value: number) => void;
}

export function GraphCanvas({ graph, levers, effects, flash, onLeverChange }: GraphCanvasProps) {
  const layout = layoutGraph(graph, UI_LAYOUT);
  const placements = new Map(layout.placements.map((placement) => [placement.id, placement]));
  const effectByNode = new Map(effects.map((effect) => [effect.nodeId, effect]));
  const backEdges = new Set(layout.backEdges.map((edge) => `${edge.from}\u0000${edge.to}`));

  const nodes: IndicatorFlowNode[] = graph.nodes.map((node) => {
    const placement = placements.get(node.id);
    if (placement === undefined) throw new Error(`layout omitted node "${node.id}"`);
    const effect = effectByNode.get(node.id);
    return {
      id: node.id,
      type: "indicator",
      position: { x: placement.x, y: placement.y },
      width: UI_LAYOUT.nodeWidth,
      height: UI_LAYOUT.nodeHeight,
      draggable: false,
      selectable: false,
      // React Flow disables pointer events when a node is neither selectable nor draggable.
      // Keep the graph fixed while allowing the embedded sliders and source links to receive input.
      style: { pointerEvents: "all" },
      data: {
        node,
        lever: levers.get(node.id) ?? 0,
        description: effect === undefined ? null : describeEffect(graph, effect),
        flashKey: flash.keys.get(node.id) ?? 0,
        onLeverChange,
      },
    };
  });

  const edges: CausalFlowEdge[] = graph.edges.map((edge) => {
    const backEdge = backEdges.has(`${edge.from}\u0000${edge.to}`);
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: "causal",
      className: `usl-edge ${edge.confidence === "modeled" ? "usl-edge-modeled" : "usl-edge-empirical"}${backEdge ? " usl-edge-back" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      ariaLabel: `${edge.claim}. Confidence: ${edge.confidence}.`,
      data: { edge, backEdge },
    };
  });

  return (
    <div className="usl-graph-viewport" aria-label="U.S. systems causal graph">
      <ReactFlow<IndicatorFlowNode, CausalFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.3, maxZoom: 0.9 }}
        minZoom={0.2}
        maxZoom={1.5}
      >
        <Background color="#cbd5e1" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
