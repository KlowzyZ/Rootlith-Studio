import { Trash2, Copy, Info } from "lucide-react";
import { type FlowNode, type Workflow } from "../schemas";
import { icons, labels } from "./node-library";
export function Inspector({
  node,
  workflow,
  change,
  remove,
  duplicate,
}: {
  node?: FlowNode;
  workflow: Workflow;
  change: (n: FlowNode) => void;
  remove: () => void;
  duplicate: () => void;
}) {
  if (!node)
    return (
      <aside className="inspector">
        <h3>Workflow details</h3>
        <p>Select a node to configure its inputs and behavior.</p>
        <div className="explanation">{workflow.description}</div>
        <p>
          Connect an output handle to the next step. Questions and conditions
          require both Yes and No branches.
        </p>
      </aside>
    );
  const n = node,
    Icon = icons[n.kind];
  const config = (key: string, value: unknown) =>
    change({ ...n, config: { ...n.config, [key]: value } });
  return (
    <aside className="inspector">
      <div className="inspector-title">
        <span className={`node-icon ${n.kind}`}>
          <Icon size={21} />
        </span>
        <div>
          <h3>{labels[n.kind]}</h3>
          <p>Step configuration</p>
        </div>
      </div>
      <div className="panel-tab">Configuration</div>
      <label>
        Label
        <input
          value={n.label}
          maxLength={120}
          onChange={(e) => change({ ...n, label: e.target.value })}
        />
      </label>
      <label>
        Description
        <textarea
          value={n.description}
          maxLength={2000}
          onChange={(e) => change({ ...n, description: e.target.value })}
        />
      </label>
      {["dns", "tcp"].includes(n.kind) && (
        <label>
          Hostname
          <input
            aria-label="Hostname"
            value={n.config.host || ""}
            onChange={(e) => config("host", e.target.value)}
          />
          <small>One hostname or IP. No wildcards.</small>
        </label>
      )}
      {n.kind === "tcp" && (
        <label>
          Port
          <input
            type="number"
            min={1}
            max={65535}
            value={n.config.port || 443}
            onChange={(e) => config("port", Number(e.target.value))}
          />
        </label>
      )}
      {n.kind === "http" && (
        <label>
          Endpoint URL
          <input
            value={n.config.url || ""}
            onChange={(e) => config("url", e.target.value)}
          />
          <small>HTTP(S), no credentials or query strings.</small>
        </label>
      )}
      {["dns", "tcp", "http"].includes(n.kind) && (
        <label>
          Timeout (ms)
          <input
            type="number"
            min={100}
            max={10000}
            value={n.config.timeout}
            onChange={(e) => config("timeout", Number(e.target.value))}
          />
        </label>
      )}
      {n.kind === "choice" && (
        <label>
          Choices (one per line)
          <textarea
            value={n.config.choices?.join("\n") || ""}
            onChange={(e) => config("choices", e.target.value.split("\n"))}
          />
        </label>
      )}
      {n.kind === "condition" && (
        <>
          <label>
            Evidence source
            <select
              value={n.config.source || ""}
              onChange={(e) => config("source", e.target.value)}
            >
              <option value="">Select a previous step</option>
              {workflow.nodes
                .filter((x) => x.id !== n.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Output field
            <select
              value={n.config.field || "ok"}
              onChange={(e) => config("field", e.target.value)}
            >
              {["ok", "status", "answer"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Operator
            <select
              value={n.config.operator || "equals"}
              onChange={(e) => config("operator", e.target.value)}
            >
              <option value="equals">Equals</option>
              <option value="notEquals">Does not equal</option>
            </select>
          </label>
          <label>
            Expected value
            <input
              value={String(n.config.value ?? true)}
              onChange={(e) => {
                const v = e.target.value;
                config(
                  "value",
                  v === "true"
                    ? true
                    : v === "false"
                      ? false
                      : n.config.field === "status"
                        ? Number(v)
                        : v,
                );
              }}
            />
            <small>Typed boolean, status number, or answer text.</small>
          </label>
        </>
      )}
      <section className="node-info">
        <h4>Node information</h4>
        <div>
          <span>Type</span>
          <code>{n.kind}</code>
        </div>
        <div>
          <span>Connected exits</span>
          <span>{workflow.edges.filter((e) => e.source === n.id).length}</span>
        </div>
        <div>
          <span>Execution</span>
          <span>
            {["dns", "tcp", "http", "interfaces"].includes(n.kind)
              ? "Read-only diagnostic"
              : "Guided step"}
          </span>
        </div>
      </section>
      <div className="explanation">
        <Info size={16} />
        <strong>How it works</strong>
        <p>
          {n.kind === "condition"
            ? "Compares one typed output from an executed step. Missing evidence stops execution as inconclusive."
            : n.kind === "http"
              ? "Sends a bounded HEAD request. Redirects are reported, never followed. No response body is stored."
              : n.kind === "interfaces"
                ? "Reads adapter addresses locally. MAC addresses are withheld. No network settings are changed."
                : "This step runs only on the selected path. Network checks require explicit approval in Rootlith Desktop."}
        </p>
      </div>
      <div className="inspector-actions">
        <button onClick={duplicate}>
          <Copy size={14} /> Duplicate
        </button>
        <button className="danger" onClick={remove}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </aside>
  );
}
