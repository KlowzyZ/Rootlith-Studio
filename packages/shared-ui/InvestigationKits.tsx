import { useMemo, useRef, useState } from "react";
import {
  addKit,
  investigationKits,
  prepareKit,
  prepareFromLocalKit,
} from "../core/investigation-kits";
import {
  assertLocalKit,
  localKits,
  removeLocalTemplate,
  workflowFingerprint,
  MAX_LOCAL_KITS,
} from "../core/local-kits";
import { starter } from "../core/starters";
import type { Store } from "../core/storage";
import type { Workflow } from "../schemas";
import type { InvestigationCase } from "../core/cases";
import { LocalKitEditor } from "./LocalKitEditor";
import { useDialog } from "./useDialog";
type Props = {
  store: Store;
  save: (reduce: (s: Store) => Store) => Promise<void>;
  close: () => void;
  created: (value: InvestigationCase, workflow: Workflow) => void;
};
export function InvestigationKits(props: Props) {
  const [author, setAuthor] = useState<Workflow>(),
    [selected, setSelected] = useState("camera");
  return author ? (
    <LocalKitEditor
      store={props.store}
      source={author}
      save={props.save}
      close={() => setAuthor(undefined)}
      saved={(w) => {
        setSelected(w.id);
        setAuthor(undefined);
      }}
    />
  ) : (
    <KitCatalog
      {...props}
      initialKey={selected}
      author={(w) => setAuthor(structuredClone(w))}
    />
  );
}
function KitCatalog({
  store,
  save,
  close,
  created,
  initialKey,
  author,
}: Props & { initialKey: string; author: (w: Workflow) => void }) {
  const [query, setQuery] = useState(""),
    [key, setKey] = useState(initialKey),
    [name, setName] = useState(""),
    [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState<Workflow>();
  const lock = useRef(false),
    ref = useDialog(close, busy);
  const own = useMemo(() => localKits(store), [store.workflows]);
  const builtin = investigationKits.find((k) => k.key === key),
    local = own.find((w) => w.id === key);
  const graph = useMemo(
    () => (builtin ? starter(builtin.key) : local),
    [builtin, local],
  );
  const localError = (() => {
    if (!local) return "";
    try {
      assertLocalKit(local);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  })();
  const items = [
    ...investigationKits.map((k) => ({
      id: k.key,
      name: k.name,
      text: `${k.audience} ${k.intent}`,
      own: false,
    })),
    ...own.map((w) => ({
      id: w.id,
      name: w.name,
      text: w.description,
      own: true,
    })),
  ].filter((k) =>
    `${k.name} ${k.text}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const full =
    store.workflows.length >= 100 || (store.cases?.length || 0) >= 80;
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kit-title"
        data-case-dialog="true"
        data-unsaved={!!name || !!profileId}
        data-saving={busy}
        className="modal kit-dialog"
      >
        <div className="kit-heading">
          <small>OFFLINE TECHNICIAN LIBRARY</small>
          <h2 id="kit-title">New from Kit</h2>
          <p>
            Inspect a built-in or local blueprint. Confirm to save one
            independent case and playbook; configure targets explicitly
            afterward.
          </p>
        </div>
        {!window.fixflow && (
          <p className="kit-simulation">
            BROWSER SIMULATION · no native checks are performed.
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current || !graph || localError) return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              const fingerprint = local && workflowFingerprint(local);
              const draft = builtin
                ? prepareKit(builtin.key, name, profileId || undefined)
                : prepareFromLocalKit(local!, name, profileId || undefined);
              await save((s) => {
                if (
                  local &&
                  !s.workflows.some(
                    (w) =>
                      w.id === local.id &&
                      workflowFingerprint(w) === fingerprint,
                  )
                )
                  throw Error(
                    "Local kit changed since preview. Reopen the library.",
                  );
                return addKit(s, draft);
              });
              created(draft.investigation, draft.workflow);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
              lock.current = false;
            }
          }}
        >
          <fieldset disabled={busy}>
            <div className="kit-columns">
              <div className="kit-catalog">
                <label>
                  Search kits
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Built-in or local guidance…"
                  />
                </label>
                <div
                  className="kit-options"
                  aria-label="Investigation kits"
                  onKeyDown={(e) => {
                    if (
                      !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
                    )
                      return;
                    const buttons = [
                        ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                          "button",
                        ),
                      ],
                      index = buttons.indexOf(
                        document.activeElement as HTMLButtonElement,
                      );
                    if (index < 0) return;
                    e.preventDefault();
                    buttons[
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? buttons.length - 1
                          : Math.max(
                              0,
                              Math.min(
                                buttons.length - 1,
                                index + (e.key === "ArrowDown" ? 1 : -1),
                              ),
                            )
                    ]?.focus();
                  }}
                >
                  {items.map((k) => (
                    <button
                      type="button"
                      key={k.id}
                      aria-pressed={key === k.id}
                      onClick={() => {
                        setKey(k.id);
                        setDeleting(undefined);
                        setError("");
                      }}
                    >
                      <strong>{k.name}</strong>
                      <small>
                        {k.own
                          ? "Local · independent reusable blueprint"
                          : "Built-in · immutable"}
                      </small>
                    </button>
                  ))}
                </div>
                {!items.length && (
                  <p>No kits match. Clear the search to browse the library.</p>
                )}
                <p>
                  {own.length}/{MAX_LOCAL_KITS} local kits · included within 100
                  saved workflows.
                </p>
                <button
                  type="button"
                  disabled={
                    !store.workflows.length || own.length >= MAX_LOCAL_KITS
                  }
                  onClick={() => author(local || store.workflows[0])}
                >
                  Save workflow as local kit
                </button>
              </div>
              <div className="kit-preview">
                <h3>{builtin?.name || local?.name || "Select a kit"}</h3>
                <p>
                  {builtin?.intent ||
                    local?.description ||
                    "No guidance recorded."}
                </p>
                <h4>Prerequisites / human guidance</h4>
                <p>
                  {builtin?.prerequisites ||
                    "Review the local guidance and retained question/condition values. No source case notes, evidence or target profile is copied."}
                </p>
                <h4>Configuration and limits</h4>
                <p>
                  {builtin?.configuration ||
                    "All hosts, ports and HTTP URLs/paths must be configured explicitly for the new investigation."}
                </p>
                <p>
                  {builtin?.limitations ||
                    "Local guidance is technician authored, not a diagnostic result. Existing read-only providers and exact-scope approval apply. No scanning or repair."}
                </p>
                {localError && <p role="alert">{localError}</p>}
                {graph && (
                  <details>
                    <summary>
                      Step and branch structure · {graph.nodes.length} steps
                    </summary>
                    <ol>
                      {graph.nodes.map((n) => (
                        <li key={n.id}>
                          <strong>{n.label}</strong> · {n.kind}
                          <p>{n.description}</p>
                          <ul>
                            {graph.edges
                              .filter((e) => e.source === n.id)
                              .map((e) => (
                                <li key={e.id}>
                                  {e.branch || "Next"} →{" "}
                                  {
                                    graph.nodes.find((n) => n.id === e.target)
                                      ?.label
                                  }
                                </li>
                              ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {builtin && (
                  <details>
                    <summary>Suggested evidence interpretation</summary>
                    <p>{builtin.interpretation}</p>
                  </details>
                )}
                {local && (
                  <div className="workbench-actions">
                    <button
                      type="button"
                      disabled={own.length >= MAX_LOCAL_KITS}
                      onClick={() => author(local)}
                    >
                      Duplicate local kit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(structuredClone(local))}
                    >
                      Delete local kit
                    </button>
                  </div>
                )}
                {deleting && (
                  <div className="task-confirm" role="alert">
                    <p>
                      Delete this reusable template? Existing independent
                      case/playbook copies remain. Direct case/origin references
                      must be unlinked first. Back up before deletion if needed.
                    </p>
                    <button
                      type="button"
                      onClick={() => setDeleting(undefined)}
                    >
                      Keep local kit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await save((s) =>
                            removeLocalTemplate(
                              s,
                              deleting.id,
                              workflowFingerprint(deleting),
                            ),
                          );
                          setDeleting(undefined);
                          setKey("camera");
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Confirm delete local kit
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="kit-setup">
              <label>
                Investigation name
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Site / device / observed symptom"
                />
              </label>
              <label>
                Contextual target profile
                <select
                  aria-label="Contextual target profile"
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                >
                  <option value="">
                    None — configure targets explicitly later
                  </option>
                  {store.targetProfiles?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              A profile link is context only; it never populates targets. All
              three built-ins remain unchanged. Instances use fresh case,
              workflow and (for local copies) step identities.
            </p>
          </fieldset>
          {full && (
            <p role="alert">
              Case/workflow capacity reached (80 / 100). No partial creation is
              allowed.
            </p>
          )}
          {error && <p role="alert">{error} No success acknowledged.</p>}
          <p role="status">
            {busy
              ? "Waiting for case/playbook save acknowledgment…"
              : "Preview only. Nothing runs or applies targets during creation."}
          </p>
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || full || !name.trim() || !graph || !!localError}
            >
              Create investigation
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
