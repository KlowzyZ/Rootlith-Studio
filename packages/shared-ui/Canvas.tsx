import "@xyflow/react/dist/style.css";
import { icons, labels } from "./node-library";
import { memo, useEffect, useMemo, useState } from "react";
import {
  ReactFlowProvider,
  useReactFlow,
  BaseEdge,
  type EdgeProps,
  ReactFlow,
  Background,
  Controls,
  Panel,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import { GitBranch } from "lucide-react";
import {
  connectionError,
  kinds,
  type FlowNode,
  type Workflow,
} from "../schemas";
import type { Step } from "../workflow-engine";
type Data = { node: FlowNode; step?: Step };
const FlowCard = memo(
  function FlowCard({ data, selected }: NodeProps<Node<Data>>) {
    const n = data.node;
    const Icon = icons[n.kind];
    const branches = ["question", "confirmation", "condition"].includes(n.kind)
      ? ["true", "false"]
      : n.kind === "choice"
        ? n.config.choices
        : undefined;
    return (
      <div
        className={`flow-card ${selected ? "selected" : ""} ${data.step?.status || ""}`}
      >
        <Handle
          type="target"
          position={Position.Top}
          isConnectable={n.kind !== "start"}
        />
        <div className={`node-icon ${n.kind}`}>
          <Icon size={18} />
        </div>
        <div className="node-copy">
          <strong title={n.label}>{n.label}</strong>
          <span title={n.config.host || n.config.url || labels[n.kind]}>
            {n.config.host || n.config.url || labels[n.kind]}
          </span>
        </div>
        {data.step && (
          <span
            className="step-dot"
            role="status"
            aria-label={data.step.status}
            title={data.step.status}
          />
        )}
        {n.kind !== "end" &&
          (branches ? (
            branches.map((b, i) => (
              <Handle
                key={b}
                id={b}
                type="source"
                position={Position.Bottom}
                style={{ left: `${((i + 1) * 100) / (branches.length + 1)}%` }}
              />
            ))
          ) : (
            <Handle type="source" position={Position.Bottom} />
          ))}
      </div>
    );
  },
  (previous, next) =>
    previous.selected === next.selected &&
    previous.data.node === next.data.node &&
    previous.data.step === next.data.step,
);
const nodeTypes = { flow: FlowCard };
// Keep long branch/join edges beside the intervening cards after arrangement.
function DetourEdge(props: EdgeProps) {
  const lane = Math.max(props.sourceX, props.targetX) + 190;
  const path = `M ${props.sourceX},${props.sourceY} L ${props.sourceX},${props.sourceY + 24} L ${lane},${props.sourceY + 24} L ${lane},${props.targetY - 24} L ${props.targetX},${props.targetY - 24} L ${props.targetX},${props.targetY}`;
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      style={props.style}
      label={props.label}
      labelX={lane}
      labelY={props.sourceY + 38}
      labelStyle={props.labelStyle}
      labelShowBg={props.labelShowBg}
      labelBgStyle={props.labelBgStyle}
    />
  );
}
const edgeTypes = { detour: DetourEdge };
function FlowCanvas({
  workflow,
  selected,
  steps,
  onSelect,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onDrop,
  disabled,
  ready,
}: {
  workflow: Workflow;
  selected: string;
  steps: Step[];
  onSelect: (id: string) => void;
  onNodesChange: (c: NodeChange[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection, replacing?: string) => void;
  onDrop: (kind: FlowNode["kind"], position: { x: number; y: number }) => void;
  disabled: boolean;
  ready: (
    fit: (options?: {
      padding?: number;
      maxZoom?: number;
      duration?: number;
    }) => Promise<boolean>,
  ) => void;
}) {
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [reconnecting, setReconnecting] = useState<string>();
  const { screenToFlowPosition, fitView } = useReactFlow();
  useEffect(() => {
    ready(fitView);
    return () => ready(async () => false);
  }, [ready, fitView]);
  const stepById = useMemo(
    () => new Map(steps.map((s) => [s.nodeId, s])),
    [steps],
  );
  const nodeById = useMemo(
    () => new Map(workflow.nodes.map((n) => [n.id, n])),
    [workflow.nodes],
  );
  const nodes = useMemo(
    () =>
      workflow.nodes.map((n) => ({
        id: n.id,
        ariaLabel: `${n.label}: ${stepById.get(n.id)?.status || "not run"}`,
        selected: n.id === selected,
        type: "flow",
        width: 258,
        measured: measurements[n.id] || { width: 258, height: 70 },
        position: n.position,
        data: { node: n, step: stepById.get(n.id) },
      })),
    [workflow.nodes, selected, stepById, measurements],
  );
  const edges = useMemo(
    () =>
      workflow.edges.map((e) => ({
        ...e,
        selected: selectedEdges.includes(e.id),
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6c8583" },
        sourceHandle: e.branch,
        label:
          e.branch === "true" ? "Yes" : e.branch === "false" ? "No" : e.branch,
        type:
          (nodeById.get(e.target)?.position.y ?? 0) -
            (nodeById.get(e.source)?.position.y ?? 0) >
          230
            ? "detour"
            : "smoothstep",
      })),
    [workflow.edges, nodeById, selectedEdges],
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onlyRenderVisibleElements={workflow.nodes.length > 60}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      onNodesChange={(changes) => {
        const dimensions = changes.filter(
          (c) => c.type === "dimensions" && c.dimensions,
        );
        const removed = new Set(
          changes.filter((c) => c.type === "remove").map((c) => c.id),
        );
        if (dimensions.length || removed.size)
          setMeasurements((previous) => {
            let next = previous;
            if (removed.size)
              next = Object.fromEntries(
                Object.entries(previous).filter(([id]) => !removed.has(id)),
              );
            for (const c of dimensions) {
              if (c.type !== "dimensions" || !c.dimensions) continue;
              const before = previous[c.id];
              if (
                before?.width !== c.dimensions.width ||
                before?.height !== c.dimensions.height
              ) {
                next = { ...next, [c.id]: c.dimensions };
              }
            }
            return next;
          });
        onNodesChange(changes);
      }}
      onEdgesChange={(changes) => {
        setSelectedEdges((ids) => {
          let next = [...ids];
          for (const c of changes) {
            if (c.type === "select") {
              next = next.filter((id) => id !== c.id);
              if (c.selected) next.push(c.id);
            } else if (c.type === "remove")
              next = next.filter((id) => id !== c.id);
          }
          return next;
        });
        onEdgesChange(changes);
      }}
      onConnect={(c) => onConnect(c)}
      onReconnect={(edge, c) => onConnect(c, edge.id)}
      isValidConnection={(c) => !connectionError(workflow, c, reconnecting)}
      onReconnectStart={(_, edge) => setReconnecting(edge.id)}
      onReconnectEnd={() => setReconnecting(undefined)}
      nodesDraggable={!disabled}
      nodesConnectable={!disabled}
      edgesReconnectable={!disabled}
      deleteKeyCode={disabled ? null : ["Backspace", "Delete"]}
      fitView
      fitViewOptions={{ padding: 0.16, maxZoom: 0.9 }}
      minZoom={0.25}
      maxZoom={1.5}
      colorMode="dark"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const kind = e.dataTransfer.getData(
          "application/fixflow",
        ) as FlowNode["kind"];
        if (!disabled && kinds.includes(kind))
          onDrop(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
    >
      {!workflow.nodes.length && (
        <div className="canvas-empty">
          <GitBranch size={30} />
          <h3>Build your first path</h3>
          <p>
            Add a Start step, then connect instructions,
            <br />
            questions and read-only checks from the library.
          </p>
          <button
            onClick={() => onDrop("start", { x: 300, y: 0 })}
            disabled={disabled}
          >
            Add Start
          </button>
        </div>
      )}
      <Panel
        position="top-right"
        className="canvas-view-tools"
        aria-label="Canvas view"
      >
        <button
          onClick={() =>
            void fitView({
              padding: 0.16,
              maxZoom: 0.9,
              duration: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? 0
                : 180,
            })
          }
        >
          Fit graph
        </button>
        <button
          disabled={!nodeById.has(selected)}
          onClick={() =>
            void fitView({
              nodes: [{ id: selected }],
              padding: 0.5,
              minZoom: 0.8,
              maxZoom: 1,
              duration: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? 0
                : 180,
            })
          }
        >
          Focus selected
        </button>
      </Panel>
      <Background gap={22} size={1} />
      <Controls showInteractive={false} />
      {workflow.nodes.length > 20 && (
        <MiniMap pannable zoomable nodeColor="#578d7e" maskColor="#101417bb" />
      )}
    </ReactFlow>
  );
}

export function Canvas(props: Parameters<typeof FlowCanvas>[0]) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
