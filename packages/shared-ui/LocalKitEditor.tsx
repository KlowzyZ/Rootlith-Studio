import { useRef, useState } from "react";
import {
  prepareLocalTemplate,
  saveLocalTemplate,
  workflowFingerprint,
  LOCAL_KIT_TAG,
} from "../core/local-kits";
import type { Store } from "../core/storage";
import type { Workflow } from "../schemas";
import { useDialog } from "./useDialog";
export function LocalKitEditor({
  store,
  source: initial,
  save,
  close,
  saved,
}: {
  store: Store;
  source: Workflow;
  save: (reduce: (s: Store) => Store) => Promise<void>;
  close: () => void;
  saved: (w: Workflow) => void;
}) {
  const [source, setSource] = useState(() => structuredClone(initial));
  const make = (w: Workflow) => {
    try {
      return {
        draft: prepareLocalTemplate(
          w,
          w.tags.includes(LOCAL_KIT_TAG)
            ? `${w.name.slice(0, 115)} copy`
            : "Untitled local kit",
          w.tags.includes(LOCAL_KIT_TAG) ? w.description : "",
          w.tags.includes(LOCAL_KIT_TAG),
        ),
        error: "",
      };
    } catch (e) {
      return { draft: undefined, error: (e as Error).message };
    }
  };
  const [plan, setPlan] = useState(() => make(initial));
  const [reviewed, setReviewed] = useState(false),
    [wording, setWording] = useState(initial.tags.includes(LOCAL_KIT_TAG)),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [nodeIndex, setNodeIndex] = useState(0);
  const lock = useRef(false),
    ref = useDialog(close, busy);
  const draft = plan.draft,
    node = draft?.nodes[nodeIndex];
  const change = (value: Workflow) => {
    setPlan({ draft: value, error: "" });
    setReviewed(false);
    setNotice("");
  };
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-kit-title"
        data-case-dialog="true"
        data-unsaved="true"
        data-saving={busy}
        className="modal kit-author"
      >
        <h2 id="local-kit-title">Save workflow as local kit</h2>
        <p>
          Create a separate reusable blueprint, never a run. All concrete hosts,
          ports, HTTP URLs/paths, author metadata and source IDs are removed.
          Case notes, reports and profiles are never copied.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current || !draft || !reviewed) return;
            lock.current = true;
            setBusy(true);
            setNotice("");
            try {
              await save((s) =>
                saveLocalTemplate(
                  s,
                  source.id,
                  workflowFingerprint(source),
                  draft,
                ),
              );
              saved(draft);
            } catch (e) {
              setNotice(`Not saved: ${(e as Error).message}`);
              setBusy(false);
              lock.current = false;
            }
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Source workflow
              <select
                aria-label="Kit source workflow"
                value={source.id}
                onChange={(e) => {
                  const w = store.workflows.find(
                    (w) => w.id === e.target.value,
                  );
                  if (w) {
                    setSource(structuredClone(w));
                    setPlan(make(w));
                    setNodeIndex(0);
                    setWording(w.tags.includes(LOCAL_KIT_TAG));
                    setReviewed(false);
                    setNotice("");
                  }
                }}
              >
                {!store.workflows.some((w) => w.id === source.id) && (
                  <option value={source.id}>Source no longer saved</option>
                )}
                {store.workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            {draft && (
              <>
                <label>
                  Local kit name
                  <input
                    required
                    maxLength={120}
                    value={draft.name}
                    onChange={(e) => change({ ...draft, name: e.target.value })}
                  />
                </label>
                <label>
                  Prerequisites and human guidance
                  <textarea
                    aria-label="Prerequisites and human guidance"
                    maxLength={2000}
                    rows={4}
                    value={draft.description}
                    onChange={(e) =>
                      change({ ...draft, description: e.target.value })
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={wording}
                    onChange={(e) => {
                      setWording(e.target.checked);
                      change({
                        ...draft,
                        nodes: draft.nodes.map((n, i) => ({
                          ...n,
                          label: e.target.checked
                            ? source.nodes[i].label
                            : `${n.kind.toUpperCase()} · ${i + 1}`,
                          description: e.target.checked
                            ? source.nodes[i].description
                            : "",
                        })),
                      });
                    }}
                  />
                  Copy source step wording for manual review (may contain
                  private text)
                </label>
                <div className="kit-guidance-editor">
                  <label>
                    Edit human guidance for step
                    <select
                      aria-label="Kit guidance step"
                      value={nodeIndex}
                      onChange={(e) => setNodeIndex(Number(e.target.value))}
                    >
                      {draft.nodes.map((n, i) => (
                        <option value={i} key={n.id}>
                          {i + 1}. {n.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {node && (
                    <>
                      <label>
                        Kit step label
                        <input
                          required
                          maxLength={120}
                          value={node.label}
                          onChange={(e) =>
                            change({
                              ...draft,
                              nodes: draft.nodes.map((n, i) =>
                                i === nodeIndex
                                  ? { ...n, label: e.target.value }
                                  : n,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Kit step guidance
                        <textarea
                          aria-label="Kit step guidance"
                          maxLength={2000}
                          value={node.description}
                          onChange={(e) =>
                            change({
                              ...draft,
                              nodes: draft.nodes.map((n, i) =>
                                i === nodeIndex
                                  ? { ...n, description: e.target.value }
                                  : n,
                              ),
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
                <details>
                  <summary>
                    Exact target-free blueprint · {draft.nodes.length} steps
                  </summary>
                  <pre className="dossier-payload">
                    {JSON.stringify(draft, null, 2)}
                  </pre>
                </details>
                <p className="target-error">
                  Branch choices, condition values and timeouts are retained as
                  data. Review them and all authored text for
                  credentials/private details. HTTP paths must be configured
                  again in each investigation. This local template is included
                  unredacted in workspace backups.
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed the blueprint, choices and guidance; it contains no
                  credentials or private site notes.
                </label>
              </>
            )}
          </fieldset>
          {plan.error && <p role="alert">{plan.error}</p>}
          <p role="status">
            {notice ||
              (busy
                ? "Waiting for local kit save acknowledgment…"
                : "Not saved. The source workflow remains unchanged.")}
          </p>
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={close}>
              Back to kit library
            </button>
            <button
              type="submit"
              className="primary"
              disabled={
                busy ||
                !reviewed ||
                !draft?.name.trim() ||
                !draft.nodes.every((n) => n.label.trim())
              }
            >
              Save local kit
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
